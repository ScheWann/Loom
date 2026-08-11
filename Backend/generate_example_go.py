"""
Bake GO analysis results into the frontend's example data.

Loading the example replays a recorded session into the frontend, but leaves the
backend's PROCESSED_ADATA_CACHE empty, so clicking a UMAP cluster cannot run GO
enrichment. The results are small (5 terms per cluster), so they are computed once
here and stored in example_state.json instead.

Run from the Backend directory, with the sample data available:

    venv/bin/python generate_example_go.py

Re-run it whenever the example is re-recorded.
"""

import json
import os
import sys

import pandas as pd

import process

EXAMPLE_STATE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "Frontend", "public", "example_state.json",
)


def cluster_number(cluster_label):
    """'Cluster 3' -> '3'."""
    return str(cluster_label).split(" ")[-1]


def build_cache_for_dataset(dataset):
    """
    Rebuild the processed AnnData the UMAP was produced from, then force the recorded
    cluster labels onto it so the GO results line up with what the example displays.
    """
    sample_id = dataset["sampleId"]
    title = dataset["adata_umap_title"]
    points = dataset["data"]

    # The last three components of the title are the UMAP parameters.
    parts = title.split("_")
    n_neighbors, n_pcas, resolutions = int(parts[-3]), int(parts[-2]), float(parts[-1])

    cell_ids = [point["id"] for point in points]
    print(f"  rebuilding cache for {title} ({len(cell_ids)} cells)...", flush=True)

    result = process.get_umap_data(
        sample_id=sample_id,
        cell_ids=cell_ids,
        n_neighbors=n_neighbors,
        n_pcas=n_pcas,
        resolutions=resolutions,
        adata_umap_title=title,
    )

    if result.get("status") != "success":
        raise RuntimeError(f"get_umap_data failed: {result.get('message')}")

    adata = process.get_processed_adata(sample_id, title)
    leiden_col = f"leiden_{title}"

    recorded = pd.Series(
        {point["id"]: cluster_number(point["cluster"]) for point in points}
    )
    aligned = recorded.reindex(adata.obs_names)

    # Cells outside the recording are left as NA; perform_go_analysis drops those.
    matched = int(aligned.notna().sum())
    print(f"  recorded labels applied to {matched}/{adata.n_obs} cached cells", flush=True)
    if matched == 0:
        raise RuntimeError("None of the recorded cells survived the UMAP pipeline")

    adata.obs[leiden_col] = pd.Categorical(aligned)

    return sample_id, title, sorted(set(aligned.dropna()), key=int)


def main():
    with open(EXAMPLE_STATE) as handle:
        snapshot = json.load(handle)

    datasets = snapshot.get("umapDataSets") or []
    if not datasets:
        sys.exit("example_state.json has no umapDataSets")

    process.load_adata_to_cache(snapshot["samples"])

    go_analysis = {}

    for dataset in datasets:
        sample_id, title, clusters = build_cache_for_dataset(dataset)
        per_cluster = {}

        for cluster in clusters:
            print(f"  GO analysis for cluster {cluster}...", flush=True)
            try:
                per_cluster[cluster] = process.perform_go_analysis(
                    sample_id=sample_id,
                    cluster_id=cluster,
                    adata_umap_title=title,
                )
            except Exception as error:
                print(f"  ! cluster {cluster} failed: {error}", flush=True)

        go_analysis[title] = per_cluster

    snapshot["goAnalysis"] = go_analysis

    with open(EXAMPLE_STATE, "w") as handle:
        json.dump(snapshot, handle)

    total = sum(len(v) for v in go_analysis.values())
    size_mb = os.path.getsize(EXAMPLE_STATE) / 1024 / 1024
    print(f"\nWrote GO results for {total} clusters. example_state.json is now {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
