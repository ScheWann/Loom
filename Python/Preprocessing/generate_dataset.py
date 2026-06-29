#!/usr/bin/env python
"""
generate_dataset.py
===================

One-command preprocessing pipeline that turns a raw Visium HD output into the
exact files the Loom backend/frontend expect, places them in
``Example_Data`` following the existing per-sample folder layout, and registers
the new sample in ``Backend/samples_list.json`` automatically.

It is the scripted, non-interactive equivalent of the notebooks in this folder:

  * ``0.image_preprocessing.ipynb``   -> HD lite JPEG (frontend builds minimap from it)
  * ``1.bin2cell.ipynb``              -> 2um bin2cell single-cell aggregation
  * ``1.5.quality_control_2um.ipynb`` -> 2um QC + annotation
  * ``2.quality_control_8um.ipynb``   -> 8um QC + annotation
  * ``3.quality_control_16um.ipynb``  -> 16um QC + annotation
  * ``4.spata_processing.R``          -> SPATA2 16um .rds for trajectories

All visualization-only cells from the notebooks are intentionally omitted.

Pipeline per requested scale
----------------------------
  2um  : bin2cell (notebook 1) -> QC 2um (notebook 1.5)
  8um  : QC bin    (notebook 2)
  16um : QC bin    (notebook 3)

QC keeps MAD filtering -> normalize -> log1p -> CellTypist annotation. The
global HVG/scale/PCA/UMAP/Leiden block from the notebooks is OFF by default
(--with-clustering to re-enable): the backend re-clusters per ROI online, so
its X_pca/X_umap/leiden are never read and it is the slow part on large bins.

What gets produced / placed (defaults, ``Mouse_Brain`` shown as example)
------------------------------------------------------------------------
  Example_Data/Mouse_Brain_<scale>/stardist/he.tiff                 (image_tif_path)
  Example_Data/Mouse_Brain_<scale>/Mouse_Brain_<scale>_lite.jpeg    (image_jpeg_path)
  Example_Data/Mouse_Brain_<scale>/mouse_brain_<scale>_b2c_qc.h5ad  (adata_path)
  Example_Data/mouse_brain_scalefactors_json.json                   (scalefactors_16um_path)
  Example_Data/mouse_brain_tissue_positions.parquet                 (tissue_positions_16um_path)
  Example_Data/mouse_brain_16um_object_processed.rds                (rds_path; skip with --no-spata2)
  Backend/samples_list.json                                         (entry added/merged)

Example
-------
  python generate_dataset.py \
      --name Mouse_Brain \
      --binned-outputs "./mouse_brain/binned_outputs" \
      --source-image  "./Visium_HD_Mouse_Brain_tissue_image.tif" \
      --scales 2um \
      --celltypist-model Mouse_Isocortex_Hippocampus.pkl \
      --mito-prefix mt-
"""

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Repository layout (resolved from this file's location)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent              # Python/Preprocessing
REPO_ROOT = SCRIPT_DIR.parent.parent                      # repo root
EXAMPLE_DATA = REPO_ROOT / "Example_Data"
BACKEND_DIR = REPO_ROOT / "Backend"
SAMPLES_JSON = BACKEND_DIR / "samples_list.json"

# Visium HD binned subdirectory for each supported scale
SCALE_TO_SQUARE = {"2um": "square_002um", "8um": "square_008um", "16um": "square_016um"}
ALL_SCALES = list(SCALE_TO_SQUARE.keys())

# Microns-per-pixel for the scaled H&E image. Must stay consistent with the
# notebooks (they all use 0.5) and with the backend scalefactor key
# 'tissue_0.5_mpp_150_buffer_scalef'.
MPP = 0.5


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def fmt_duration(seconds):
    """Format a duration in seconds as 'Hh Mm Ss'."""
    seconds = int(seconds)
    return f"{seconds // 3600}h {(seconds % 3600) // 60}m {seconds % 60}s"


def rel_to_backend(path: Path) -> str:
    """JSON paths are stored relative to Backend/ (e.g. '../Example_Data/...')."""
    return os.path.relpath(Path(path).resolve(), BACKEND_DIR).replace(os.sep, "/")


# ---------------------------------------------------------------------------
# Shared QC helper (identical logic to every notebook)
# ---------------------------------------------------------------------------
def _is_outlier(adata, metric, nmads):
    import numpy as np
    from scipy.stats import median_abs_deviation

    M = adata.obs[metric]
    return (M < np.median(M) - nmads * median_abs_deviation(M)) | (
        np.median(M) + nmads * median_abs_deviation(M) < M
    )


def _flag_and_filter_qc(adata, mito_prefix, mt_pct_cap=8):
    """Compute QC metrics, MAD outliers, and return the filtered AnnData.

    Mirrors the shared QC block used by notebooks 1.5 / 2 / 3.
    """
    import scanpy as sc

    adata.var["mt"] = adata.var_names.str.startswith(mito_prefix)
    sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], percent_top=[20], inplace=True)

    adata.obs["outlier"] = (
        _is_outlier(adata, "log1p_total_counts", 5)
        | _is_outlier(adata, "log1p_n_genes_by_counts", 5)
        | _is_outlier(adata, "pct_counts_in_top_20_genes", 5)
    )
    adata.obs["mt_outlier"] = _is_outlier(adata, "pct_counts_mt", 3) | (
        adata.obs["pct_counts_mt"] > mt_pct_cap
    )

    n_before = adata.n_obs
    adata = adata[(~adata.obs.outlier) & (~adata.obs.mt_outlier)].copy()
    log(f"  QC filter: {n_before} -> {adata.n_obs} observations kept")
    return adata


def ensure_celltypist_model(model, auto_download=True):
    """Make sure a CellTypist model is available before annotation.

    CellTypist models are downloaded on demand into a shared, env-independent
    folder (~/.celltypist/data/models). annotate() does NOT auto-download, so a
    model that was never fetched raises 'No such file'. This downloads it once.
    A model given as an existing file path is used as-is.
    """
    from celltypist import models

    if os.path.isfile(model):
        return  # explicit path to a .pkl on disk

    if model in models.get_all_models():
        return  # already downloaded into the shared models folder

    if not auto_download:
        raise FileNotFoundError(
            f"CellTypist model '{model}' is not downloaded and --no-auto-download "
            f"was set. Run: python -c \"from celltypist import models; "
            f"models.download_models(model='{model}')\""
        )

    log(f"CellTypist model '{model}' not found locally; downloading...")
    models.download_models(model=model)
    if model not in models.get_all_models():
        raise FileNotFoundError(
            f"CellTypist model '{model}' could not be downloaded. Check the name "
            f"with: python -c \"from celltypist import models; "
            f"print(models.models_description())\""
        )
    log(f"CellTypist model '{model}' downloaded to {models.models_path}")


def _normalize_annotate_reduce(adata, celltypist_model, n_top_genes, resolution,
                               with_clustering=False):
    """normalize -> log1p -> CellTypist, then optionally HVG/scale/PCA/UMAP/Leiden.

    Shared by notebooks 1.5 / 2 / 3. The only preprocessing output the Loom
    backend consumes is the CellTypist `predicted_labels` annotation (plus the
    raw counts and spatial coords); it re-runs HVG/PCA/UMAP/Leiden online per
    ROI (see process.py get_umap_data). So the global clustering here is off by
    default -- it is the slow part on large bin counts and the backend never
    reads its X_pca/X_umap/leiden. Pass with_clustering=True to reproduce the
    notebook-identical artifact.
    """
    import celltypist
    import scanpy as sc

    log("  normalize_total + log1p")
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)

    if with_clustering:
        log("  highly_variable_genes (seurat_v3)")
        sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, flavor="seurat_v3")

    log(f"  CellTypist annotate with model '{celltypist_model}' ({adata.n_obs} obs)")
    predictions = celltypist.annotate(adata, model=celltypist_model)
    adata = predictions.to_adata()

    if not with_clustering:
        log("  clustering skipped (backend re-clusters per ROI online)")
        return adata

    # The remaining steps (esp. neighbors/UMAP/Leiden) scale with cell count and
    # are the slow part on large bin counts -- log each so progress is visible.
    adata = adata[:, adata.var["highly_variable"]].copy()
    log(f"  scale + PCA ({adata.n_obs} obs x {adata.n_vars} HVGs)")
    sc.pp.scale(adata, max_value=10)
    sc.pp.pca(adata, use_highly_variable=True)
    log("  neighbors")
    sc.pp.neighbors(adata)
    log("  UMAP (slow on large bin counts)")
    sc.tl.umap(adata)
    log(f"  Leiden clustering (resolution={resolution})")
    sc.tl.leiden(adata, resolution=resolution, key_added="leiden")
    log("  dimensionality reduction + clustering done")
    return adata


# ---------------------------------------------------------------------------
# Stage 1 -- 2um: bin2cell (notebook 1)
# ---------------------------------------------------------------------------
def run_bin2cell_2um(square_dir: Path, source_image: Path, stardist_dir: Path,
                     b2c_h5ad_out: Path):
    """Aggregate 2um bins into single cells. Writes he.tiff + intermediate b2c h5ad."""
    import os as _os
    _os.environ["OPENCV_IO_MAX_IMAGE_PIXELS"] = str(2 ** 32)
    import bin2cell as b2c
    import cv2
    import scanpy as sc

    stardist_dir.mkdir(parents=True, exist_ok=True)
    he_tiff = stardist_dir / "he.tiff"
    he_npz = stardist_dir / "he.npz"
    gex_tiff = stardist_dir / "gex.tiff"
    gex_npz = stardist_dir / "gex.npz"

    log("  bin2cell: read_visium")
    adata = b2c.read_visium(str(square_dir), source_image_path=str(source_image))
    adata.var_names_make_unique()

    sc.pp.filter_genes(adata, min_cells=3)
    sc.pp.filter_cells(adata, min_counts=1)

    log("  bin2cell: scaled_he_image")
    b2c.scaled_he_image(adata, mpp=MPP, save_path=str(he_tiff))

    log("  bin2cell: destripe")
    b2c.destripe(adata, adjust_counts=True)

    log("  bin2cell: stardist on H&E (2D_versatile_he)")
    b2c.stardist(image_path=str(he_tiff), labels_npz_path=str(he_npz),
                 stardist_model="2D_versatile_he", prob_thresh=0.01)
    b2c.insert_labels(adata, labels_npz_path=str(he_npz), basis="spatial",
                      spatial_key="spatial_cropped_150_buffer", mpp=MPP,
                      labels_key="labels_he")
    b2c.expand_labels(adata, labels_key="labels_he",
                      expanded_labels_key="labels_he_expanded")

    log("  bin2cell: grid_image + stardist on GEX (2D_versatile_fluo)")
    img = b2c.grid_image(adata, "n_counts_adjusted", mpp=MPP, sigma=5)
    cv2.imwrite(str(gex_tiff), img)
    b2c.stardist(image_path=str(gex_tiff), labels_npz_path=str(gex_npz),
                 stardist_model="2D_versatile_fluo", prob_thresh=0.05, nms_thresh=0.5)
    b2c.insert_labels(adata, labels_npz_path=str(gex_npz), basis="array", mpp=MPP,
                      labels_key="labels_gex")

    log("  bin2cell: salvage_secondary_labels + bin_to_cell")
    b2c.salvage_secondary_labels(adata, primary_label="labels_he_expanded",
                                 secondary_label="labels_gex", labels_key="labels_joint")
    cdata = b2c.bin_to_cell(adata, labels_key="labels_joint",
                            spatial_keys=["spatial", "spatial_cropped_150_buffer"])

    b2c_h5ad_out.parent.mkdir(parents=True, exist_ok=True)
    cdata.write_h5ad(str(b2c_h5ad_out))
    log(f"  bin2cell: wrote {b2c_h5ad_out.name}")
    return he_tiff


# ---------------------------------------------------------------------------
# Stage 2 -- 2um QC (notebook 1.5)
# ---------------------------------------------------------------------------
def run_qc_2um(b2c_h5ad: Path, qc_h5ad_out: Path, celltypist_model, mito_prefix,
               min_bins, n_top_genes, resolution, with_clustering=False):
    import numpy as np
    import scanpy as sc

    log("  QC 2um: load b2c h5ad")
    cdata = sc.read_h5ad(str(b2c_h5ad))

    cdata = cdata[cdata.obs["bin_count"] > (min_bins - 1)].copy()
    # seurat_v3 HVG needs integer counts
    if hasattr(cdata.X, "data"):
        cdata.X.data = np.round(cdata.X.data)
    else:
        cdata.X = np.round(cdata.X)
    cdata.raw = cdata.copy()

    cdata = _flag_and_filter_qc(cdata, mito_prefix)
    cdata = _normalize_annotate_reduce(cdata, celltypist_model, n_top_genes,
                                       resolution, with_clustering=with_clustering)

    qc_h5ad_out.parent.mkdir(parents=True, exist_ok=True)
    cdata.raw.to_adata().write(str(qc_h5ad_out))
    log(f"  QC 2um: wrote {qc_h5ad_out.name}")


# ---------------------------------------------------------------------------
# Stage 2 -- 8um / 16um QC (notebooks 2 / 3)
# ---------------------------------------------------------------------------
def run_qc_bin(square_dir: Path, source_image: Path, stardist_dir: Path,
               qc_h5ad_out: Path, celltypist_model, mito_prefix, n_top_genes,
               resolution, with_clustering=False):
    import bin2cell as b2c
    import scanpy as sc

    stardist_dir.mkdir(parents=True, exist_ok=True)
    he_tiff = stardist_dir / "he.tiff"

    log("  QC bin: read_visium")
    bdata = b2c.read_visium(str(square_dir), source_image_path=str(source_image))
    bdata.var_names_make_unique()
    bdata.raw = bdata.copy()

    sc.pp.filter_genes(bdata, min_cells=3)
    sc.pp.filter_cells(bdata, min_genes=100)

    bdata = _flag_and_filter_qc(bdata, mito_prefix)
    bdata = _normalize_annotate_reduce(bdata, celltypist_model, n_top_genes,
                                       resolution, with_clustering=with_clustering)

    log("  QC bin: scaled_he_image (background)")
    b2c.scaled_he_image(bdata, mpp=MPP, save_path=str(he_tiff))

    qc_h5ad_out.parent.mkdir(parents=True, exist_ok=True)
    bdata.raw.to_adata().write(str(qc_h5ad_out))
    log(f"  QC bin: wrote {qc_h5ad_out.name}")
    return he_tiff


# ---------------------------------------------------------------------------
# Image processing (notebook 0)
# ---------------------------------------------------------------------------
def generate_lite_jpeg(he_tiff: Path, out_jpeg: Path, quality=100):
    """High-quality HD JPEG used by the viewer (image_jpeg_path)."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None

    out_jpeg.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(str(he_tiff))
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(str(out_jpeg), format="JPEG", quality=quality)
    log(f"  image: wrote lite JPEG {out_jpeg.name} (q={quality})")


# ---------------------------------------------------------------------------
# 16um reference files (scalefactors + tissue_positions) for trajectory analysis
# ---------------------------------------------------------------------------
def extract_16um_refs(binned_outputs: Path, scalefactors_out: Path,
                      tissue_positions_out: Path):
    """Copy the 16um spatial scalefactors/tissue_positions into Example_Data."""
    spatial = binned_outputs / SCALE_TO_SQUARE["16um"] / "spatial"
    src_sf = spatial / "scalefactors_json.json"
    src_tp = spatial / "tissue_positions.parquet"

    if not src_sf.exists() or not src_tp.exists():
        log(f"  refs: square_016um/spatial not found ({spatial}); skipping 16um refs")
        return None, None

    shutil.copy2(src_sf, scalefactors_out)
    shutil.copy2(src_tp, tissue_positions_out)
    log(f"  refs: copied scalefactors -> {scalefactors_out.name}")
    log(f"  refs: copied tissue_positions -> {tissue_positions_out.name}")
    return scalefactors_out, tissue_positions_out


# ---------------------------------------------------------------------------
# SPATA2 16um .rds (notebook 4) -- required for trajectory analysis
# ---------------------------------------------------------------------------
def run_spata2(binned_outputs: Path, sample_name: str, rds_out: Path):
    """Generate the processed 16um SPATA2 object via Rscript.

    SPATA2's initiateSpataObjectVisiumHD expects a Visium HD sample directory
    that *contains* a binned_outputs folder, so we point it at the parent of
    --binned-outputs. Raises on any failure (this step is mandatory unless the
    caller passed --no-spata2).
    """
    import subprocess
    import tempfile

    rscript = shutil.which("Rscript")
    if not rscript:
        raise RuntimeError(
            "SPATA2 step requires Rscript on PATH but it was not found. Install R "
            "+ SPATA2, or pass --no-spata2 to skip .rds generation."
        )

    square_16 = binned_outputs / SCALE_TO_SQUARE["16um"]
    if not square_16.exists():
        raise FileNotFoundError(
            f"SPATA2 needs the 16um binned output but {square_16} was not found."
        )

    visium_dir = binned_outputs.parent
    r_code = f'''
        library(SPATA2)
        library(tidyverse)
        object <- initiateSpataObjectVisiumHD(
        sample_name = "{sample_name}",
        directory_visium = "{visium_dir.as_posix()}",
        square_res = "16um"
        )
        object <- identifyPixelContent(object, frgmt_threshold = c(0.01,0.05))
        object <- identifyTissueOutline(object, method = "image")
        object <- removeGenesStress(object)
        object <- removeGenesZeroCounts(object)
        object <- removeObsZeroCounts(object)
        object <- normalizeCounts(object, method = "LogNormalize")
        object <- identifyVariableMolecules(object, method = "vst", n_mol = 2500)
        saveRDS(object, file = "{rds_out.as_posix()}")
        message("Saved SPATA2 object to ", normalizePath("{rds_out.as_posix()}"))
    '''
    with tempfile.NamedTemporaryFile("w", suffix=".R", delete=False) as fh:
        fh.write(r_code)
        r_path = fh.name

    log(f"  spata2: running Rscript (square_res=16um, dir={visium_dir})")
    try:
        subprocess.run([rscript, r_path], check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"SPATA2 Rscript failed (exit {exc.returncode}). "
                           f"See the R output above.") from exc
    finally:
        os.unlink(r_path)

    if not rds_out.exists():
        raise RuntimeError(f"SPATA2 finished but {rds_out} was not written.")
    log(f"  spata2: wrote {rds_out.name}")
    return rds_out


# ---------------------------------------------------------------------------
# samples_list.json registration
# ---------------------------------------------------------------------------
def get_library_key(qc_h5ad: Path) -> str:
    """Read the spatial library id from a produced h5ad (the backend's top-level key)."""
    import h5py
    with h5py.File(str(qc_h5ad), "r") as f:
        return list(f["uns/spatial"].keys())[0]


def update_samples_json(library_key, name, scale_entries, scalefactors_path,
                        tissue_positions_path, rds_path):
    """Add/merge the sample entry into Backend/samples_list.json."""
    with open(SAMPLES_JSON, "r") as f:
        samples = json.load(f)

    entry = samples.get(library_key, {})
    entry["id"] = name
    entry["name"] = name
    if rds_path:
        entry["rds_path"] = rel_to_backend(rds_path)
    if scalefactors_path:
        entry["scalefactors_16um_path"] = rel_to_backend(scalefactors_path)
    if tissue_positions_path:
        entry["tissue_positions_16um_path"] = rel_to_backend(tissue_positions_path)

    scales = entry.get("scales", {})
    for scale, paths in scale_entries.items():
        scales[scale] = {
            "adata_path": rel_to_backend(paths["adata"]),
            "image_tif_path": rel_to_backend(paths["he_tiff"]),
            "image_jpeg_path": rel_to_backend(paths["jpeg"]),
        }
    entry["scales"] = scales
    samples[library_key] = entry

    tmp = SAMPLES_JSON.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(samples, f, indent=4)
        f.write("\n")
    os.replace(tmp, SAMPLES_JSON)
    log(f"samples_list.json: registered '{library_key}' (scales: {', '.join(scales)})")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Generate Biovis2025 sample data from raw Visium HD output and "
                    "register it in samples_list.json.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    # Required inputs
    parser.add_argument("--name", required=True,
                        help="Sample display name / id (e.g. Mouse_Brain).")
    parser.add_argument("--binned-outputs", required=True, type=Path,
                        help="Path to the Visium HD 'binned_outputs' directory "
                             "(contains square_002um/008um/016um).")
    parser.add_argument("--source-image", required=True, type=Path,
                        help="Path to the full-resolution H&E source image (.tif/.tiff).")

    # Scale selection
    parser.add_argument("--scales", default="2um",
                        help="Comma-separated scales to generate from {2um,8um,16um}.")

    # Naming overrides (defaults reproduce the existing Example_Data layout)
    parser.add_argument("--folder-prefix", default=None,
                        help="Prefix for per-scale folders / jpegs. Default: --name.")
    parser.add_argument("--file-prefix", default=None,
                        help="Prefix for h5ad / refs / rds files. Default: lowercased --name.")

    # Annotation / QC knobs
    parser.add_argument("--celltypist-model", default="Adult_Human_Skin.pkl",
                        help="CellTypist model name (must match the tissue/species!).")
    parser.add_argument("--mito-prefix", default="MT-",
                        help="Mitochondrial gene prefix ('MT-' human, 'mt-' mouse).")
    parser.add_argument("--no-auto-download", dest="auto_download",
                        action="store_false",
                        help="Do not auto-download the CellTypist model if missing.")
    parser.add_argument("--min-bins", type=int, default=8,
                        help="2um only: minimum bins per cell (bin_count >= this).")
    parser.add_argument("--n-top-genes", type=int, default=5000,
                        help="Number of highly variable genes (seurat_v3).")
    parser.add_argument("--leiden-resolution", type=float, default=1.0,
                        help="Leiden clustering resolution (only with --with-clustering).")
    parser.add_argument("--with-clustering", action="store_true",
                        help="Also run global HVG/scale/PCA/UMAP/Leiden during QC "
                             "(notebook-identical artifact). Off by default: the backend "
                             "re-clusters per ROI online, so this is slow dead weight on "
                             "large bin counts.")

    # HD lite JPEG (image_jpeg_path); the frontend builds its minimap from this
    # at runtime, so no separate low-res image is exported.
    parser.add_argument("--no-hd-jpeg", dest="hd_jpeg", action="store_false",
                        help="Skip the HD lite JPEG (image_jpeg_path).")
    parser.add_argument("--hd-jpeg-quality", type=int, default=100)

    # 16um refs + SPATA2
    parser.add_argument("--no-16um-refs", dest="extract_refs", action="store_false",
                        help="Skip copying 16um scalefactors/tissue_positions.")
    parser.add_argument("--no-spata2", dest="run_spata2", action="store_false",
                        help="Skip the SPATA2 16um .rds generation (notebook 4). "
                             "By default it runs and is required for trajectories.")

    parser.set_defaults(hd_jpeg=True, extract_refs=True,
                        auto_download=True, run_spata2=True)
    args = parser.parse_args()

    # Resolve config
    name = args.name
    folder_prefix = args.folder_prefix or name
    file_prefix = args.file_prefix or name.lower().replace(" ", "_")
    scales = [s.strip() for s in args.scales.split(",") if s.strip()]
    bad = [s for s in scales if s not in SCALE_TO_SQUARE]
    if bad:
        parser.error(f"Unsupported scale(s): {bad}. Choose from {ALL_SCALES}.")
    if not args.binned_outputs.exists():
        parser.error(f"--binned-outputs not found: {args.binned_outputs}")
    if not args.source_image.exists():
        parser.error(f"--source-image not found: {args.source_image}")

    binned = args.binned_outputs.resolve()
    source_image = args.source_image.resolve()

    log(f"Sample '{name}'  scales={scales}  folder_prefix='{folder_prefix}'  "
        f"file_prefix='{file_prefix}'")

    # Fail fast: make sure the CellTypist model is available before any heavy compute.
    ensure_celltypist_model(args.celltypist_model, auto_download=args.auto_download)

    started = time.time()
    scale_entries = {}
    # Per-stage timings reported at the end: timings[scale] = {"b2c": s, "qc": s}.
    # b2c is only present for 2um; spata2 is timed separately below.
    timings = {}

    for scale in scales:
        log(f"=== scale {scale} ===")
        square_dir = binned / SCALE_TO_SQUARE[scale]
        if not square_dir.exists():
            log(f"  WARNING: {square_dir} not found; skipping {scale}")
            continue

        sample_dir = EXAMPLE_DATA / f"{folder_prefix}_{scale}"
        stardist_dir = sample_dir / "stardist"
        qc_h5ad = sample_dir / f"{file_prefix}_{scale}_b2c_qc.h5ad"
        timings[scale] = {}

        if scale == "2um":
            b2c_h5ad = sample_dir / f"{file_prefix}_2um_b2c.h5ad"
            t0 = time.time()
            he_tiff = run_bin2cell_2um(square_dir, source_image, stardist_dir, b2c_h5ad)
            timings[scale]["b2c"] = time.time() - t0
            t0 = time.time()
            run_qc_2um(b2c_h5ad, qc_h5ad, args.celltypist_model, args.mito_prefix,
                       args.min_bins, args.n_top_genes, args.leiden_resolution,
                       with_clustering=args.with_clustering)
            timings[scale]["qc"] = time.time() - t0
        else:
            t0 = time.time()
            he_tiff = run_qc_bin(square_dir, source_image, stardist_dir, qc_h5ad,
                                 args.celltypist_model, args.mito_prefix,
                                 args.n_top_genes, args.leiden_resolution,
                                 with_clustering=args.with_clustering)
            timings[scale]["qc"] = time.time() - t0

        # Image processing (notebook 0)
        lite_jpeg = sample_dir / f"{folder_prefix}_{scale}_lite.jpeg"
        if args.hd_jpeg:
            generate_lite_jpeg(he_tiff, lite_jpeg, quality=args.hd_jpeg_quality)
            jpeg_for_json = lite_jpeg
        else:
            jpeg_for_json = he_tiff  # fall back so the viewer still has something

        scale_entries[scale] = {"adata": qc_h5ad, "he_tiff": he_tiff,
                                "jpeg": jpeg_for_json}

    if not scale_entries:
        log("No scales were produced; nothing to register. Exiting.")
        sys.exit(1)

    # 16um reference files (for trajectory analysis)
    scalefactors_path = tissue_positions_path = None
    if args.extract_refs:
        log("=== 16um reference files ===")
        scalefactors_path, tissue_positions_path = extract_16um_refs(
            binned,
            EXAMPLE_DATA / f"{file_prefix}_scalefactors_json.json",
            EXAMPLE_DATA / f"{file_prefix}_tissue_positions.parquet",
        )

    # SPATA2 .rds (required by default; opt out with --no-spata2)
    rds_path = None
    spata2_elapsed = None
    if args.run_spata2:
        log("=== SPATA2 16um object ===")
        t0 = time.time()
        rds_path = run_spata2(binned, name,
                              EXAMPLE_DATA / f"{file_prefix}_16um_object_processed.rds")
        spata2_elapsed = time.time() - t0

    # Derive the backend's top-level key from the data, then register
    log("=== register in samples_list.json ===")
    any_qc = next(iter(scale_entries.values()))["adata"]
    library_key = get_library_key(any_qc)
    log(f"  spatial library id (samples_list key) = '{library_key}'")
    update_samples_json(library_key, name, scale_entries, scalefactors_path,
                        tissue_positions_path, rds_path)

    elapsed = time.time() - started

    # Per-stage timing breakdown.
    log("=== timing breakdown ===")
    for scale in scales:
        t = timings.get(scale)
        if not t:
            continue
        if "b2c" in t:  # 2um
            log(f"  {scale}: bin2cell {fmt_duration(t['b2c'])}, "
                f"quality control {fmt_duration(t['qc'])}")
        else:  # 8um / 16um
            log(f"  {scale}: quality control {fmt_duration(t['qc'])}")
    if spata2_elapsed is not None:
        log(f"  spata2: {fmt_duration(spata2_elapsed)}")

    log(f"Done in {fmt_duration(elapsed)}. "
        f"Restart the backend to pick up the new sample.")


if __name__ == "__main__":
    main()
