import warnings

# Configure Dask DataFrame to use new query-planning implementation
import dask
dask.config.set({"dataframe.query-planning": True})

# Suppress specific FutureWarnings at the application level
warnings.filterwarnings("ignore", category=FutureWarning, module="dask.dataframe")
warnings.filterwarnings("ignore", category=FutureWarning, module="anndata")
warnings.filterwarnings("ignore", message=".*legacy Dask DataFrame implementation.*")
warnings.filterwarnings("ignore", message=".*Importing read_text from.*anndata.*")

from flask import Flask, request, jsonify, send_file
from process import SAMPLES
from flask_cors import CORS
import re
import os
from process import (
    get_samples_option,
    get_hires_image_size,
    get_coordinates,
    get_gene_list,
    get_cell_types_data,
    get_kosara_data,
    get_single_gene_expression_data,
    get_umap_data,
    perform_go_analysis,
    get_trajectory_data,
    get_trajectory_gene_list,
    load_adata_to_cache,
    clear_adata_cache,
    clear_trajectory_analysis_cache,
    get_trajectory_gene_expression,
    get_direct_slingshot_data,
    analyze_trajectory,
    get_sample_regions,
    get_region_trajectories,
    get_trajectory_significant_genes,
    get_trajectory_spata2_data,
    get_highly_variable_genes
)


app = Flask(__name__)
CORS(app)

# UPLOAD_FOLDER = "../Uploaded_Data"
# os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def _search_genes_internal(sample_ids, query, limit=50):
    """
    Core gene search logic. Returns a dict mapping sample_id -> list of matching gene names.
    """
    if not sample_ids or not isinstance(sample_ids, list):
        raise ValueError("sample_ids must be a non-empty list")
    if not query or len(query) < 1:
        return {sid: [] for sid in sample_ids}

    sample_gene_dict = get_gene_list(sample_ids)
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results = {}
    for sid in sample_ids:
        genes = sample_gene_dict.get(sid, [])
        matches = [g for g in genes if pattern.search(g)]
        if isinstance(limit, int) and limit > 0:
            matches = matches[:limit]
        results[sid] = matches
    return results


@app.route("/api/load_adata_cache", methods=["POST"])
def load_adata_cache_route():
    """
    Load AnnData objects for the given sample IDs into the global cache.
    This should be called once when samples are confirmed.
    """
    sample_ids = request.json["sample_ids"]
    try:
        load_adata_to_cache(sample_ids)
        return jsonify(
            {
                "status": "success",
                "message": f"Loaded AnnData for {len(sample_ids)} samples",
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/clear_adata_cache", methods=["POST"])
def clear_adata_cache_route():
    """
    Clear the global AnnData cache to free memory.
    """
    try:
        clear_adata_cache()
        return jsonify({"status": "success", "message": "AnnData cache cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/clear_trajectory_analysis_cache", methods=["POST"])
def clear_trajectory_analysis_cache_route():
    """
    Clear the global trajectory analysis cache to free memory.
    """
    try:
        clear_trajectory_analysis_cache()
        return jsonify({"status": "success", "message": "Trajectory analysis cache cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_samples_option", methods=["GET"])
def get_samples_option_route():
    """
    Get a list of available samples for the selector, grouped by cell scale(e.g., 2um, 8um)
    """
    return jsonify(get_samples_option())


@app.route("/api/get_hires_image_size", methods=["POST"])
def get_hires_image_size_route():
    """
    Get high-resolution image size(width, height) for the selected samples
    """
    sample_ids = request.json["sample_ids"]
    return jsonify(get_hires_image_size(sample_ids))


@app.route("/api/get_coordinates", methods=["POST"])
def get_coordinates_route():
    """
    Get coordinates(x, y) for the selected samples
    """
    sample_ids = request.json["sample_ids"]
    return jsonify(get_coordinates(sample_ids))


@app.route("/api/get_highly_variable_genes", methods=["POST"])
def get_highly_variable_genes_route():
    """
    Get list of highly variable genes for the selected samples
    """
    sample_ids = request.json["sample_ids"]
    top_n = request.json.get("top_n", 20)

    # Allow clients to request all genes by passing top_n as 'all', None, 0, or negative
    if isinstance(top_n, str) and top_n.lower() == "all":
        top_n_value = "all"
    else:
        top_n_value = top_n
    return jsonify(get_highly_variable_genes(sample_ids, top_n_value))


@app.route("/api/get_gene_name_search", methods=["POST"])
def search_genes_unified_route():
    """
    Unified gene search endpoint.
    - Multi-sample style: { sample_ids: [..], query: string, limit?: int } -> returns { sample_id: [genes] }
    - Single-sample style: { sample_id: string, gene_name: string, limit?: int } -> returns [genes]
    """
    data = request.json or {}

    # Single-sample payload
    if "sample_id" in data and "gene_name" in data:
        sample_id = data.get("sample_id")
        gene_name = data.get("gene_name", "")
        limit = data.get("limit", 50)
        try:
            results = _search_genes_internal([sample_id], gene_name, limit)
            return jsonify(results.get(sample_id, []))
        except Exception:
            return jsonify([])

    # New multi-sample payload
    sample_ids = data.get("sample_ids", [])
    # Fallback: support 'gene_name' as alias for 'query'
    query = data.get("query", data.get("gene_name", ""))
    limit = data.get("limit", 50)

    try:
        results = _search_genes_internal(sample_ids, query, limit)
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_kosara_data", methods=["POST"])
def get_kosara_data_route():
    """
    Get Kosara visualization format data
    """
    sample_ids = request.json["sample_ids"]
    gene_list = request.json["gene_list"]

    return jsonify(get_kosara_data(sample_ids, gene_list))


@app.route("/api/get_single_gene_expression", methods=["POST"])
def get_single_gene_expression_route():
    """
    Get single gene expression data for sequential coloring
    """
    sample_ids = request.json["sample_ids"]
    gene_name = request.json["gene_name"]
    cell_list = request.json.get("cell_list", None)

    return jsonify(get_single_gene_expression_data(sample_ids, gene_name, cell_list))


@app.route("/api/get_umap_data", methods=["POST"])
def get_umap_data_route():
    """
    Generate UMAP data from gene expression data
    """
    sample_id = request.json["sample_id"]
    cell_ids = request.json.get("cell_ids", None)
    n_neighbors = request.json.get("n_neighbors", 10)
    n_pcas = request.json.get("n_pcas", 30)
    resolutions = request.json.get("resolutions", 1)
    adata_umap_title = request.json.get("adata_umap_title", None)
    try:
        umap_data = get_umap_data(
            sample_id=sample_id,
            cell_ids=cell_ids,
            n_neighbors=n_neighbors,
            n_pcas=n_pcas,
            resolutions=resolutions,
            adata_umap_title=adata_umap_title,
        )
        return jsonify(umap_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_go_analysis", methods=["POST"])
def get_go_analysis_route():
    """
    Perform GO analysis on selected cluster cells
    """
    sample_id = request.json["sample_id"]
    cluster_id = request.json["cluster_id"]
    adata_umap_title = request.json["adata_umap_title"]

    try:
        go_results = perform_go_analysis(
            sample_id=sample_id,
            cluster_id=cluster_id,
            adata_umap_title=adata_umap_title,
        )
        return jsonify(go_results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_trajectory_gene_list", methods=["POST"])
def get_trajectory_gene_list_route():
    """
    Get list of available genes from trajectory data
    """
    sample_id = request.json["sample_id"]
    is_vertical = request.json.get("is_vertical")

    try:
        gene_list = get_trajectory_gene_list(
            sample_id=sample_id, is_vertical=is_vertical
        )
        return jsonify(gene_list)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_trajectory_data", methods=["POST"])
def get_trajectory_data_route():
    """
    Get trajectory gene expression data for line chart visualization
    """
    sample_id = request.json["sample_id"]
    selected_genes = request.json.get("selected_genes", None)
    is_vertical = request.json.get("is_vertical")

    try:
        trajectory_data = get_trajectory_data(
            sample_id=sample_id, selected_genes=selected_genes, is_vertical=is_vertical
        )
        return jsonify(trajectory_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_cell_types", methods=["POST"])
def get_cell_types():
    """
    Get cell types and their counts from adata.obs['predicted_labels'].value_counts()
    """
    sample_ids = request.json["sample_ids"]

    if not sample_ids:
        return jsonify({"error": "No sample IDs provided"}), 400

    try:
        cell_types_data = get_cell_types_data(sample_ids)
        return jsonify(cell_types_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_hires_image", methods=["POST"])
def get_hires_image_route():
    """
    Return the full high-resolution image for the given sample_id as JPEG.
    """
    sample_id = request.json["sample_id"]

    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        return jsonify({"error": f"Sample {base_sample_id} not found"}), 404

    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        return (
            jsonify(
                {"error": f"Scale {scale} not found for sample {base_sample_id}"}
            ),
            404,
        )

    scale_info = sample_info["scales"][scale]
    image_path = scale_info["image_jpeg_path"]

    return send_file(image_path, mimetype="image/jpeg", as_attachment=False)


@app.route("/api/get_cell_boundary_image", methods=["POST"])
def get_cell_boundary_image_route():
    """
    Return the cell boundary image for the given sample_id as PNG.
    """
    sample_id = request.json["sample_id"]

    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        return jsonify({"error": f"Sample {base_sample_id} not found"}), 404

    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        return (
            jsonify(
                {"error": f"Scale {scale} not found for sample {base_sample_id}"}
            ),
            404,
        )

    scale_info = sample_info["scales"][scale]
    cell_boundary_path = scale_info["cell_boundary_path"]

    return send_file(cell_boundary_path, mimetype="image/png", as_attachment=False)


@app.route("/api/upload_spaceranger", methods=["POST"])
def upload_spaceranger():
    """
    Upload Spaceranger output files and save them in the appropriate directory structure.
    """
    name = request.form.get("name")
    files = request.files.getlist("files")

    focus_patterns = [
        re.compile(r"binned_outputs/square_002um/filtered_feature_bc_matrix\.h5$"),
        re.compile(r"binned_outputs/square_008um/filtered_feature_bc_matrix\.h5$"),
        re.compile(r"binned_outputs/square_016um/filtered_feature_bc_matrix\.h5$"),
        re.compile(r"spatial/"),
    ]

    uploaded_scales = set()

    for file in files:
        rel_path = file.filename

        subdir = None
        for pattern in focus_patterns:
            if pattern.search(rel_path):
                if "binned_outputs/square_002um" in rel_path:
                    subdir = "binned_outputs/square_002um"
                    uploaded_scales.add("2um")
                elif "binned_outputs/square_008um" in rel_path:
                    subdir = "binned_outputs/square_008um"
                    uploaded_scales.add("8um")
                elif "binned_outputs/square_016um" in rel_path:
                    subdir = "binned_outputs/square_016um"
                    uploaded_scales.add("16um")
                elif "spatial/" in rel_path:
                    subdir = os.path.join(
                        "spatial", os.path.relpath(rel_path, start="spatial")
                    )
                break
        if subdir:
            if subdir.startswith("spatial"):
                save_path = os.path.join(UPLOAD_FOLDER, name, subdir)
            else:
                save_path = os.path.join(
                    UPLOAD_FOLDER, name, subdir, os.path.basename(rel_path)
                )
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            file.save(save_path)

    return jsonify(
        {
            "status": "success",
            "uploaded_scales": list(uploaded_scales),
            "message": f"Uploaded data for scales: {', '.join(uploaded_scales)}",
        }
    )


@app.route("/api/get_direct_slingshot_data", methods=["POST"])
def get_direct_slingshot_data_route():
    """
    Generate direct Slingshot analysis data with an optional start cluster
    """
    sample_id = request.json["sample_id"]
    cell_ids = request.json["cell_ids"]
    adata_umap_title = request.json["adata_umap_title"]
    start_cluster = request.json.get("start_cluster", None)  # Optional parameter
    n_neighbors = request.json.get("n_neighbors", 15)
    n_pcas = request.json.get("n_pcas", 30)
    resolutions = request.json.get("resolutions", 1)

    try:
        pseudotime_data = get_direct_slingshot_data(
            sample_id=sample_id,
            adata_umap_title=adata_umap_title,
            cell_ids=cell_ids,
            start_cluster=start_cluster,
            n_neighbors=n_neighbors,
            n_pcas=n_pcas,
            resolutions=resolutions,
        )
        return jsonify(pseudotime_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/analyze_trajectory", methods=["POST"])
def analyze_trajectory_route():
    """
    Analyze trajectory using multi-scale matching method.
    Maps coordinates from processed image to full-resolution and finds 16um barcodes.
    """
    data = request.json
    sample_id = data.get("sampleId")
    start_coordinates = data.get("startCoordinates")
    end_coordinates = data.get("endCoordinates")
    arrow_width_pixels = data.get("arrowWidthPixels")
    drawing_points = data.get("drawingPoints")
    trajectory_name = data.get("trajectoryName")
    area_name = data.get("areaName")  # Extract the area/region name
    
    # Validate required parameters
    if not all([sample_id, start_coordinates, end_coordinates, drawing_points, trajectory_name]):
        return jsonify({
            "status": "error",
            "message": "Missing required parameters: sampleId, startCoordinates, endCoordinates, drawingPoints, trajectoryName"
        }), 400
    
    if arrow_width_pixels is None:
        arrow_width_pixels = 10  # Default width
    
    try:
        result = analyze_trajectory(
            sample_id=sample_id,
            start_coordinates=start_coordinates,
            end_coordinates=end_coordinates,
            arrow_width_pixels=arrow_width_pixels,
            drawing_points=drawing_points,
            trajectory_name=trajectory_name,
            area_name=area_name  # Pass the area name to the analysis function
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Error analyzing trajectory: {str(e)}"
        }), 500


@app.route("/api/get_trajectory_gene_expression", methods=["POST"])
def get_trajectory_gene_expression_route():
    """
    Get gene expression data along a specific trajectory path
    """
    sample_id = request.json["sample_id"]
    adata_umap_title = request.json["adata_umap_title"]
    gene_names = request.json["gene_names"]
    trajectory_path = request.json["trajectory_path"]

    try:
        gene_expression_data = get_trajectory_gene_expression(
            sample_id=sample_id,
            adata_umap_title=adata_umap_title,
            gene_names=gene_names,
            trajectory_path=trajectory_path,
        )
        return jsonify(gene_expression_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_sample_regions", methods=["POST"])
def get_sample_regions_route():
    """
    Get all analyzed regions for a given sample
    """
    try:
        data = request.json
        sample_id = data.get("sample_id")
        
        if not sample_id:
            return jsonify({"error": "sample_id is required"}), 400
        
        regions = get_sample_regions(sample_id)
        return jsonify(regions)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_region_trajectories", methods=["POST"])
def get_region_trajectories_route():
    """
    Get all trajectories for a given sample and region
    """
    try:
        data = request.json
        sample_id = data.get("sample_id")
        region_id = data.get("region_id")
        
        if not sample_id or not region_id:
            return jsonify({"error": "sample_id and region_id are required"}), 400
        
        trajectories = get_region_trajectories(sample_id, region_id)
        return jsonify(trajectories)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_trajectory_genes", methods=["POST"])
def get_trajectory_genes_route():
    """
    Get significant genes for a given trajectory from SPATA2 analysis
    """
    try:
        data = request.json
        sample_id = data.get("sample_id")
        region_id = data.get("region_id")
        trajectory_id = data.get("trajectory_id")
        
        if not sample_id or not region_id or not trajectory_id:
            return jsonify({"error": "sample_id, region_id, and trajectory_id are required"}), 400
        
        genes = get_trajectory_significant_genes(sample_id, region_id, trajectory_id)
        return jsonify(genes)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/get_spata2_trajectory_data", methods=["POST"])
def get_spata2_trajectory_data_route():
    """
    Get SPATA2 trajectory data for line chart visualization
    """
    try:
        data = request.json
        sample_id = data.get("sample_id")
        region_id = data.get("region_id")  
        trajectory_id = data.get("trajectory_id")
        selected_genes = data.get("selected_genes", [])
        
        if not sample_id or not region_id or not trajectory_id or not selected_genes:
            return jsonify({"error": "sample_id, region_id, trajectory_id, and selected_genes are required"}), 400
        
        trajectory_data = get_trajectory_spata2_data(sample_id, region_id, trajectory_id, selected_genes)
        return jsonify(trajectory_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5003)
