import numpy as np
import pandas as pd
import json
import os
from collections import defaultdict
from scipy.optimize import fsolve
import scanpy as sc
from PIL import Image
import gseapy as gp
from scipy.sparse import issparse
import random
import squidpy as sq
from matplotlib.path import Path
from multiprocessing import Pool, cpu_count
from slingshot import direct_slingshot_analysis
from spata2_analysis import run_spata2_analysis

# Disable the PIL image limit entirely
Image.MAX_IMAGE_PIXELS = None

# Global AnnData cache to avoid repeated loading
ADATA_CACHE = {}

# Global cache for processed trajectory data
PROCESSED_ADATA_CACHE = {}

# Global cache for Kosara calculations (memoization for expensive fsolve calls)
KOSARA_CALCULATION_CACHE = {}

# Global cache for SPATA2 trajectory analysis results
TRAJECTORY_ANALYSIS_CACHE = {}

# Set random seed for reproducibility
SEED = 42
random.seed(SEED)
np.random.seed(SEED)

def normalize_sample_id(sample_id):
    """
    Normalize sample ID to base sample ID for consistent cache operations.
    Extracts the base sample ID by removing the scale suffix (e.g., "skin_TXK6Z4X_A1_16um" -> "skin_TXK6Z4X_A1")
    """
    if "_" in sample_id:
        # Check if the last part looks like a scale (contains 'um' and digits)
        parts = sample_id.rsplit("_", 1)
        if len(parts) == 2 and ('um' in parts[1] or parts[1].isdigit()):
            normalized = parts[0]
            print(f"NORMALIZE_DEBUG: {sample_id} -> {normalized}")
            return normalized
    print(f"NORMALIZE_DEBUG: {sample_id} -> {sample_id} (no change)")
    return sample_id

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
JSON_PATH = os.path.join(BASE_DIR, "samples_list.json")

"""
    Load sample list from a JSON file.
"""
with open(JSON_PATH, "r") as f:
    SAMPLES = json.load(f)


def load_adata_to_cache(sample_ids):
    """
    Load AnnData objects for the given sample IDs into the global cache.
    This should be called once when samples are confirmed.
    """
    global ADATA_CACHE
    
    for sample_id in sample_ids:
        # Create processed adata first 
        PROCESSED_ADATA_CACHE[sample_id] = {}
        
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id in SAMPLES and sample_id not in ADATA_CACHE:
            sample_info = SAMPLES[base_sample_id]
            if "scales" in sample_info and scale in sample_info["scales"]:
                scale_info = sample_info["scales"][scale]
                if "adata_path" in scale_info:
                    try:
                        adata = sc.read_h5ad(scale_info["adata_path"])
                        ADATA_CACHE[sample_id] = adata
                        print(f"Loaded AnnData for sample {sample_id}")
                    except Exception as e:
                        print(f"Error loading AnnData for sample {sample_id}: {e}")
                        ADATA_CACHE[sample_id] = None
                else:
                    print(f"No AnnData path found for sample {sample_id}")
                    ADATA_CACHE[sample_id] = None
            else:
                print(f"No scale {scale} found for sample {base_sample_id}")
                ADATA_CACHE[sample_id] = None


def get_cached_adata(sample_id):
    """
    Get AnnData object from cache for the given sample ID.
    """
    if sample_id not in ADATA_CACHE:
        raise ValueError(f"AnnData for sample {sample_id} not found in cache. Call load_adata_to_cache() first.")
    
    if ADATA_CACHE[sample_id] is None:
        raise ValueError(f"AnnData for sample {sample_id} failed to load.")
    
    return ADATA_CACHE[sample_id]


def get_processed_adata(sample_id, adata_umap_title):
    """
    Get processed AnnData object from cache for the given sample ID and UMAP title.
    """
    if sample_id not in PROCESSED_ADATA_CACHE:
        raise ValueError(f"Processed AnnData for sample {sample_id} not found in cache. Call load_processed_adata_to_cache() first.")
    
    if adata_umap_title not in PROCESSED_ADATA_CACHE[sample_id]:
        raise ValueError(f"Processed AnnData for sample {sample_id} with UMAP title {adata_umap_title} not found in cache. Call load_processed_adata_to_cache() first.")
    
    return PROCESSED_ADATA_CACHE[sample_id][adata_umap_title]


def clear_adata_cache():
    """
    Clear the global AnnData cache to free memory.
    """
    global ADATA_CACHE
    ADATA_CACHE.clear()
    print("AnnData cache cleared")


def clear_processed_cache():
    """
    Clear the global processed trajectory cache to free memory.
    """
    global PROCESSED_ADATA_CACHE
    PROCESSED_ADATA_CACHE.clear()
    print("Processed trajectory cache cleared")


def clear_trajectory_analysis_cache():
    """
    Clear the global trajectory analysis cache to free memory.
    This will clear all region and trajectory data used by get_sample_regions and get_region_trajectories.
    """
    global TRAJECTORY_ANALYSIS_CACHE
    TRAJECTORY_ANALYSIS_CACHE.clear()
    print("Trajectory analysis cache cleared - all regions and trajectories removed")


def clear_all_caches():
    """
    Clear all caches when frontend refreshes the page.
    This ensures clean state for region and trajectory selectors.
    """
    clear_adata_cache()
    clear_processed_cache()
    clear_trajectory_analysis_cache()
    clear_kosara_cache()
    print("All caches cleared - frontend page refresh complete")


def clear_kosara_cache():
    """Clear the Kosara calculation cache to free memory"""
    global KOSARA_CALCULATION_CACHE
    KOSARA_CALCULATION_CACHE.clear()


def get_stored_trajectory_analyses(sample_id):
    """
    Get all stored trajectory analyses for a given sample.
    Returns a dictionary with region and trajectory information.
    """
    base_sample_id = normalize_sample_id(sample_id)
    
    print(f"Looking for analyses for base_sample_id={base_sample_id} (from sample_id={sample_id})")
    print(f"Available samples in cache: {list(TRAJECTORY_ANALYSIS_CACHE.keys())}")
    
    if base_sample_id not in TRAJECTORY_ANALYSIS_CACHE:
        print(f"No analyses found for {base_sample_id}")
        return {}
    
    analyses = TRAJECTORY_ANALYSIS_CACHE[base_sample_id]
    print(f"Found analyses for {base_sample_id}: {list(analyses.keys())}")
    return analyses


def store_region(sample_id, region_name):
    """
    Store a region for a given sample without any trajectory analysis.
    This allows regions to be available in the selector before trajectories are analyzed.
    """
    base_sample_id = normalize_sample_id(sample_id)

    if base_sample_id not in TRAJECTORY_ANALYSIS_CACHE:
        TRAJECTORY_ANALYSIS_CACHE[base_sample_id] = {}
    
    if region_name not in TRAJECTORY_ANALYSIS_CACHE[base_sample_id]:
        TRAJECTORY_ANALYSIS_CACHE[base_sample_id][region_name] = {}


def store_trajectory_analysis(sample_id, region_name, trajectory_name, analysis_result):
    """
    Store trajectory analysis results for later retrieval.
    """
    base_sample_id = normalize_sample_id(sample_id)
    
    print(f"Storing analysis for base_sample_id={base_sample_id}, region_name={region_name}, trajectory_name={trajectory_name}")
    
    if base_sample_id not in TRAJECTORY_ANALYSIS_CACHE:
        TRAJECTORY_ANALYSIS_CACHE[base_sample_id] = {}
        print(f"Created new cache entry for sample {base_sample_id}")
    
    if region_name not in TRAJECTORY_ANALYSIS_CACHE[base_sample_id]:
        TRAJECTORY_ANALYSIS_CACHE[base_sample_id][region_name] = {}
        print(f"Created new region {region_name} for sample {base_sample_id}")
    
    TRAJECTORY_ANALYSIS_CACHE[base_sample_id][region_name][trajectory_name] = analysis_result
    print(f"Stored trajectory {trajectory_name} in region {region_name}")

    print(f"Current cache structure for {base_sample_id}: {list(TRAJECTORY_ANALYSIS_CACHE[base_sample_id].keys())}")
    if region_name in TRAJECTORY_ANALYSIS_CACHE[base_sample_id]:
        print(f"Trajectories in {region_name}: {list(TRAJECTORY_ANALYSIS_CACHE[base_sample_id][region_name].keys())}")


def get_sample_regions(sample_id):
    """
    Get all analyzed regions for a given sample.
    """
    analyses = get_stored_trajectory_analyses(sample_id)
    
    regions = []
    
    for region_name in analyses.keys():
        regions.append({
            "id": region_name,
            "name": region_name,
            "description": f"Analyzed region: {region_name}"
        })
    
    return regions


def get_region_trajectories(sample_id, region_id):
    """
    Get all trajectories for a given sample and region.
    """
    analyses = get_stored_trajectory_analyses(sample_id)
    trajectories = []
    
    if region_id in analyses:
        print(f"Found region {region_id} with trajectories: {list(analyses[region_id].keys())}")
        for trajectory_name in analyses[region_id].keys():
            trajectories.append({
                "id": trajectory_name,
                "name": trajectory_name,
                "description": f"Trajectory: {trajectory_name}"
            })
    
    print(f"Returning {len(trajectories)} trajectories")
    return trajectories


def get_trajectory_significant_genes(sample_id, region_id, trajectory_id):
    """
    Get significant genes for a given trajectory from stored SPATA2 analysis.
    """
    print(f"Getting significant genes for: sample_id={sample_id}, region_id={region_id}, trajectory_id={trajectory_id}")
    
    analyses = get_stored_trajectory_analyses(sample_id)
    print(f"Available analyses for sample {sample_id}: {list(analyses.keys())}")
    
    if region_id in analyses:
        print(f"Available trajectories in region {region_id}: {list(analyses[region_id].keys())}")
        
        if trajectory_id in analyses[region_id]:
            analysis_result = analyses[region_id][trajectory_id]
            if "spata2_analysis" in analysis_result:
                significant_genes = analysis_result["spata2_analysis"].get("significant_genes", [])
                print(f"Found {len(significant_genes)} significant genes: {significant_genes[:5]}...")  # Show first 5
                return significant_genes
            else:
                print("No spata2_analysis found in analysis result")
        else:
            print(f"Trajectory {trajectory_id} not found in region {region_id}")
    else:
        print(f"Region {region_id} not found in analyses")
    
    print("Returning empty gene list")
    return []


def get_trajectory_spata2_data(sample_id, region_id, trajectory_id, selected_genes):
    """
    Get SPATA2 trajectory data for line chart visualization.
    """
    print(f"Getting SPATA2 data for: sample_id={sample_id}, region_id={region_id}, trajectory_id={trajectory_id}")
    print(f"Selected genes: {selected_genes}")
    
    analyses = get_stored_trajectory_analyses(sample_id)
    
    if region_id in analyses and trajectory_id in analyses[region_id]:
        analysis_result = analyses[region_id][trajectory_id]
        if "spata2_analysis" in analysis_result:
            spata2_data = analysis_result["spata2_analysis"]
            trajectory_data_raw = spata2_data.get("trajectory_data", [])
            print(f"Found {len(trajectory_data_raw)} raw trajectory data points")
            
            # Process the data to group by gene (variables)
            trajectory_data = {}
            
            for gene in selected_genes:
                # Filter data for this specific gene
                gene_data = [row for row in trajectory_data_raw if row.get("variables") == gene]
                print(f"Gene {gene}: found {len(gene_data)} data points")
                
                if gene_data:
                    # Sort by x coordinate to ensure proper line progression
                    gene_data.sort(key=lambda row: row.get("x", 0))
                    
                    trajectory_data[gene] = {
                        "data": gene_data
                    }
            
            print(f"Returning trajectory data for {len(trajectory_data)} genes")
            return trajectory_data
        else:
            print("No spata2_analysis found in analysis result")
    else:
        print(f"Region {region_id} or trajectory {trajectory_id} not found")
    
    print("Returning empty trajectory data")
    return {}


def ensure_json_serializable(value):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(value, (np.floating, np.complexfloating)):
        if np.isnan(value) or np.isinf(value):
            return 0.0
        return float(value)
    elif isinstance(value, (np.integer)):
        return int(value)
    elif isinstance(value, np.ndarray):
        return value.tolist()
    elif hasattr(value, 'item'):  # Handle numpy scalars
        return value.item()
    return value


def single_sample_coordinates(sample_id, cell_ids=None, return_format='dataframe'):
    """
    Internal helper function to get coordinates for a single sample.
    
    Parameters:
    - sample_id: Single sample ID
    - cell_ids: Optional list of specific cell IDs to filter for
    - return_format: 'dataframe' or 'records' (for dict format)
    
    Returns:
    - DataFrame or list of records with coordinates and cell types
    """
    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id in SAMPLES:
        sample_info = SAMPLES[base_sample_id]
        if "scales" in sample_info and scale in sample_info["scales"]:
            scale_info = sample_info["scales"][scale]
            if "adata_path" in scale_info:
                try:
                    adata = get_cached_adata(sample_id)
                    
                    # Build coordinate DataFrame with standard column names
                    if 'spatial_cropped_150_buffer' in adata.obsm:
                        # Use base_sample_id for spatial data access
                        scalef = adata.uns['spatial'][base_sample_id]['scalefactors']['tissue_0.5_mpp_150_buffer_scalef']
                        coords_array = adata.obsm['spatial_cropped_150_buffer'] * scalef
                        coords_df = pd.DataFrame(
                            coords_array,
                            columns=['cell_x', 'cell_y'],
                            index=adata.obs_names
                        )
                    else:
                        print(f"Warning: No spatial coordinates found for sample {sample_id}")
                        coords_df = pd.DataFrame(columns=['cell_x', 'cell_y'], index=adata.obs_names if hasattr(adata, 'obs_names') else [])

                    # Determine cell label column preference
                    if hasattr(adata, 'obs') and len(adata.obs) > 0:
                        if 'predicted_labels' in adata.obs.columns:
                            cell_labels = adata.obs['predicted_labels'].astype(str)
                        elif 'cell_type' in adata.obs.columns:
                            cell_labels = adata.obs['cell_type'].astype(str)
                        else:
                            leiden_cols = [col for col in adata.obs.columns if col.startswith('leiden_')]
                            if leiden_cols:
                                lc = leiden_cols[0]
                                cell_labels = adata.obs[lc].astype(str).map(lambda v: f'Cluster {v}')
                            else:
                                cell_labels = pd.Series(['Unknown'] * adata.n_obs, index=adata.obs_names)
                    else:
                        cell_labels = pd.Series(['Unknown'] * len(coords_df), index=coords_df.index)

                    coords_df['cell_type'] = cell_labels
                    coords_df['id'] = coords_df.index
                    
                    # Filter to specific cell IDs if provided
                    if cell_ids is not None:
                        coords_df = coords_df.loc[coords_df.index.isin(cell_ids)]
                    
                    if return_format == 'records':
                        coords_df = coords_df.reset_index(drop=True)
                        return coords_df.to_dict(orient="records")
                    else:
                        return coords_df
                        
                except Exception as e:
                    print(f"Error loading adata coordinates for sample {sample_id}: {e}")
                    empty_df = pd.DataFrame(columns=['cell_x', 'cell_y', 'cell_type', 'id'])
                    return [] if return_format == 'records' else empty_df
            else:
                print(f"Warning: No coordinate data available for sample {sample_id}")
                empty_df = pd.DataFrame(columns=['cell_x', 'cell_y', 'cell_type', 'id'])
                return [] if return_format == 'records' else empty_df
        else:
            print(f"No scale {scale} found for sample {base_sample_id}")
            empty_df = pd.DataFrame(columns=['cell_x', 'cell_y', 'cell_type', 'id'])
            return [] if return_format == 'records' else empty_df
    else:
        empty_df = pd.DataFrame(columns=['cell_x', 'cell_y', 'cell_type', 'id'])
        return [] if return_format == 'records' else empty_df


def get_samples_option():
    """
    Return a list of tissue samples for selector, group by scale.

    Returns:
    - List of tissue samples grouped by scale
    """
    groups = defaultdict(list)

    for sample_id, sample in SAMPLES.items():
        if "scales" in sample:
            for scale in sample["scales"].keys():
                scale_key = f"{sample_id}_{scale}"
                groups[scale].append(
                    {"value": scale_key, "label": f"{sample['name']} ({scale})"}
                )
        else:
            print("No found for sample", sample_id)

    return [
        {"label": group, "title": group, "options": options}
        for group, options in groups.items()
    ]


def get_hires_image_size(sample_ids):
    """
    Get the size of high-resolution images for the given sample IDs.

    Parameters:
    - sample_ids: List of sample IDs

    Returns:
    - Dictionary containing image size for each sample
    """
    tissue_image_size = {}

    for sample_id in sample_ids:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id in SAMPLES:
            sample_info = SAMPLES[base_sample_id]
            if "scales" in sample_info and scale in sample_info["scales"]:
                scale_info = sample_info["scales"][scale]
                if "image_tif_path" in scale_info:
                    try:
                        image = Image.open(scale_info["image_tif_path"])
                        tissue_image_size[sample_id] = image.size
                        image.close()  # Close the image to free memory
                    except Exception as e:
                        print(f"Error loading image for sample {sample_id}: {e}")
                        tissue_image_size[sample_id] = (0, 0)
                else:
                    print(f"No image path found for sample {sample_id}")
                    tissue_image_size[sample_id] = (0, 0)
            else:
                print(f"No scale {scale} found for sample {base_sample_id}")
                tissue_image_size[sample_id] = (0, 0)

    return tissue_image_size


def get_coordinates(sample_ids):
    """
    Get cell coordinates for the given sample IDs.

    Parameters:
    - sample_ids: List of sample IDs

    Returns:
    - Dictionary containing cell coordinates for each sample
    """
    cell_coordinate_result = {}

    for sample_id in sample_ids:
        cell_coordinate_result[sample_id] = single_sample_coordinates(sample_id, return_format='records')

    return cell_coordinate_result


def get_gene_list(sample_ids):
    """
    Get the list of genes for the given sample IDs.

    Parameters:
    - sample_ids: List of sample IDs

    Returns:
    - Dictionary containing gene list for each sample
    """
    sample_gene_dict = {}

    for sample_id in sample_ids:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id in SAMPLES:
            sample_info = SAMPLES[base_sample_id]
            if "scales" in sample_info and scale in sample_info["scales"]:
                scale_info = sample_info["scales"][scale]
                if "adata_path" in scale_info:
                    try:
                        adata = get_cached_adata(sample_id)
                        gene_list = adata.var_names.tolist()
                        sample_gene_dict[sample_id] = gene_list
                    except Exception as e:
                        print(f"Error loading adata gene list for sample {sample_id}: {e}")
                        sample_gene_dict[sample_id] = []
                else:
                    print(f"Warning: No gene list data available for sample {sample_id}")
                    sample_gene_dict[sample_id] = []
            else:
                print(f"No scale {scale} found for sample {base_sample_id}")

    return sample_gene_dict


def get_cell_types_data(sample_ids):
    """
    Get cell types and their counts from adata.obs['predicted_labels'].value_counts()
    for the given sample IDs. Returns per-sample cell types instead of a combined list.

    Parameters:
    - sample_ids: List of sample IDs

    Returns:
    - Dictionary containing cell types and their counts for each sample
    """
    # Dictionary to store cell types for each sample
    sample_cell_types = {}

    for sample_id in sample_ids:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id in SAMPLES:
            sample_info = SAMPLES[base_sample_id]
            if "scales" in sample_info and scale in sample_info["scales"]:
                scale_info = sample_info["scales"][scale]
                if "adata_path" in scale_info:
                    try:
                        adata = get_cached_adata(sample_id)
                        
                        # Try to get predicted_labels first, then fall back to cell_type or leiden clustering
                        if 'predicted_labels' in adata.obs.columns:
                            cell_type_counts = adata.obs['predicted_labels'].value_counts()
                        elif 'cell_type' in adata.obs.columns:
                            cell_type_counts = adata.obs['cell_type'].value_counts()
                        else:
                            # Look for leiden clustering columns
                            leiden_cols = [col for col in adata.obs.columns if col.startswith('leiden_')]
                            if leiden_cols:
                                # Use the first leiden clustering column found
                                leiden_col = leiden_cols[0]
                                cell_type_counts = adata.obs[leiden_col].value_counts()
                                # Rename the clusters to be more descriptive
                                cell_type_counts.index = [f'Cluster {idx}' for idx in cell_type_counts.index]
                            else:
                                # No cell type information available
                                cell_type_counts = pd.Series([], dtype='int64')
                        
                        # Convert to list format sorted by count (descending)
                        cell_types_list = [
                            {'name': str(cell_type), 'count': int(count)} 
                            for cell_type, count in sorted(cell_type_counts.items(), key=lambda x: x[1], reverse=True)
                        ]
                        
                        sample_cell_types[sample_id] = cell_types_list
                        
                    except Exception as e:
                        print(f"Error loading cell types for sample {sample_id}: {e}")
                        sample_cell_types[sample_id] = []
                else:
                    print(f"Warning: No adata available for sample {sample_id}")
                    sample_cell_types[sample_id] = []
            else:
                print(f"No scale {scale} found for sample {base_sample_id}")
                sample_cell_types[sample_id] = []
        else:
            sample_cell_types[sample_id] = []

    # Return per-sample cell types
    return sample_cell_types


# get kosara data
def get_kosara_data(sample_ids, gene_list, cell_list=None):
    """
    Get Kosara data for the given sample IDs.

    Parameters:
    - sample_ids: List of sample IDs
    - gene_list: List of gene names
    - cell_list: List of cell IDs

    Returns:
    - Dictionary containing Kosara data for each sample
    """
    radius = 5
    d = np.sqrt(2) * radius

    # Pre-calculate constants
    special_r, special_d = np.sqrt(2) * radius, np.sqrt(2) * radius
    special_angle1 = np.degrees(
        np.arccos((special_r**2 + d**2 - radius**2) / (2 * special_r * d))
    )
    special_angle2 = np.degrees(
        np.arccos((radius**2 + d**2 - special_r**2) / (2 * radius * d))
    )
    special_result = (
        special_angle1 * special_r**2
        + special_angle2 * radius**2
        - d * special_r * np.sin(special_angle1)
    )
    special_value = special_result / (np.pi * radius**2)

    def equation(r, d, a, radius_val, special_value):
        angle1 = np.arccos((r**2 + d**2 - radius_val**2) / (2 * r * d))
        angle2 = np.arccos((radius_val**2 + d**2 - r**2) / (2 * radius_val * d))
        if a <= special_value:
            result = angle1 * r**2 + angle2 * radius_val**2 - d * r * np.sin(angle1)
        else:
            result = (
                angle1 * r**2
                + angle2 * radius_val**2
                - r**2 * np.sin(angle1) * np.cos(angle1)
                - radius_val**2 * np.sin(angle2) * np.cos(angle2)
            )
        return result - (a * np.pi * radius_val**2)

    def calculate_radius_vectorized(originaldf, radius_val):
        """
        Vectorized calculate_radius for better performance.
        Uses numpy operations and optimized solving instead of nested loops.
        """
        result_df = originaldf.copy()
        result_df["radius"] = radius_val
        
        # Process all genes at once using vectorized operations
        for col in gene_list:
            ratio_col = col + "_original_ratio"
            a_values = result_df[ratio_col].values
            
            # Initialize output arrays
            cal_radii = np.zeros_like(a_values, dtype=float)
            angles = np.zeros_like(a_values, dtype=float)
            
            # Handle zero values efficiently
            zero_mask = (a_values == 0)
            cal_radii[zero_mask] = 0
            angles[zero_mask] = 0
            
            # Process non-zero values
            nonzero_mask = ~zero_mask
            if np.any(nonzero_mask):
                nonzero_a_values = a_values[nonzero_mask]
                
                # Vectorized initial guesses
                guesses = np.where(nonzero_a_values <= special_value, d + 0.01, np.where(nonzero_a_values > 0.95, 8, nonzero_a_values * 10 - 1.5))
                
                # Solve for each non-zero value with caching
                for i, (a_val, guess) in enumerate(zip(nonzero_a_values, guesses)):
                    # Create cache key for memoization
                    cache_key = (round(a_val, 6), round(d, 6), round(radius_val, 6), round(special_value, 6))
                    
                    if cache_key in KOSARA_CALCULATION_CACHE:
                        cal_radius, angle = KOSARA_CALCULATION_CACHE[cache_key]
                    else:
                        try:
                            cal_radius = fsolve(
                                equation,
                                guess,
                                args=(d, a_val, radius_val, special_value),
                            )[0]
                            angle = np.degrees(
                                np.arccos(
                                    (cal_radius**2 + d**2 - radius_val**2)
                                    / (2 * cal_radius * d)
                                )
                            )
                            # Cache the result
                            KOSARA_CALCULATION_CACHE[cache_key] = (cal_radius, angle)
                        except (ValueError, RuntimeWarning) as e:
                            cal_radius, angle = np.nan, np.nan
                            KOSARA_CALCULATION_CACHE[cache_key] = (cal_radius, angle)
                    
                    # Find the original index in the full array
                    original_idx = np.where(nonzero_mask)[0][i]
                    cal_radii[original_idx] = cal_radius
                    angles[original_idx] = angle
            
            # Assign results efficiently
            result_df[f"{col}_radius"] = cal_radii
            result_df[f"{col}_angle"] = angles

        return result_df

    def filter_and_merge(cell_ids, gene_names, sample_ids):
        results = {}
        for sample_id in sample_ids:
            base_sample_id, scale = sample_id.rsplit("_", 1)
            if base_sample_id not in SAMPLES:
                raise ValueError(f"Sample {base_sample_id} not found.")
            
            sample_info = SAMPLES[base_sample_id]
            if "scales" not in sample_info or scale not in sample_info["scales"]:
                raise ValueError(f"Scale {scale} not found for sample {base_sample_id}.")
            
            adata = get_cached_adata(sample_id)

            if not cell_ids:
                valid_cell_ids = adata.obs_names.tolist()
            else:
                # Convert cell_ids to regular Python strings to avoid numpy string issues
                if hasattr(cell_ids, '__iter__') and not isinstance(cell_ids, str):
                    cell_ids = [str(cell_id) for cell_id in cell_ids]
                else:
                    cell_ids = [str(cell_ids)]
                
                valid_cell_ids = [
                    cell for cell in cell_ids if cell in adata.obs_names
                ]

            valid_gene_names = [
                gene for gene in gene_names if gene in adata.var_names
            ]

            if valid_gene_names:
                filtered_adata = adata[valid_cell_ids, valid_gene_names].copy()
                if issparse(filtered_adata.X):
                    expr_data = filtered_adata.X.toarray()
                else:
                    expr_data = filtered_adata.X
                expr_df = pd.DataFrame(
                    expr_data,
                    index=filtered_adata.obs_names,
                    columns=filtered_adata.var_names,
                )
            else:
                expr_df = pd.DataFrame(index=valid_cell_ids)

            expr_df = expr_df.reset_index().rename(columns={"index": "id"})

            missing_genes = [
                gene for gene in gene_names if gene not in expr_df.columns
            ]
            for gene in missing_genes:
                expr_df[gene] = 0

            expr_df = expr_df[["id"] + gene_names]

            coord_df = single_sample_coordinates(sample_id, return_format='dataframe').reset_index(drop=True)

            merged_df = pd.merge(expr_df, coord_df, on="id", how="inner")

            merged_df["total_expression"] = adata[valid_cell_ids, :].X.sum(axis=1)

            for gene in gene_names:
                merged_df[f"{gene}_original_ratio"] = np.where(
                    merged_df["total_expression"] == 0,
                    0,
                    merged_df[gene] / merged_df["total_expression"],
                )

            results[sample_id] = merged_df

        return results

    def process_single_sample(sample_data):
        """Helper function to process a single sample for parallel execution"""
        sample_id, merged_df = sample_data
        kosara_df = calculate_radius_vectorized(merged_df, radius)
        
        # Vectorized data formatting (avoid iterrows)
        formatted_results = []
        n_rows = len(kosara_df)
        
        # Extract common columns once
        ids = kosara_df["id"].values
        cell_x = kosara_df["cell_x"].values
        cell_y = kosara_df["cell_y"].values
        cell_types = kosara_df["cell_type"].values
        total_expressions = kosara_df["total_expression"].values
        
        # Pre-extract gene-specific columns
        gene_angles = {}
        gene_radii = {}
        gene_ratios = {}
        
        for gene in gene_list:
            gene_angles[gene] = kosara_df.get(f"{gene}_angle", pd.Series([0] * n_rows)).values
            gene_radii[gene] = kosara_df.get(f"{gene}_radius", pd.Series([0] * n_rows)).values
            gene_ratios[gene] = kosara_df.get(f"{gene}_original_ratio", pd.Series([0] * n_rows)).values
        
        # Build result list efficiently with JSON-safe conversions
        for i in range(n_rows):
            transformed_entry = {
                "id": str(ids[i]),  # Convert to string for JSON safety
                "cell_x": ensure_json_serializable(cell_x[i]),
                "cell_y": ensure_json_serializable(cell_y[i]),
                "cell_type": str(cell_types[i]),
                "total_expression": ensure_json_serializable(total_expressions[i]),
                "angles": {gene: ensure_json_serializable(gene_angles[gene][i]) for gene in gene_list},
                "radius": {gene: ensure_json_serializable(gene_radii[gene][i]) for gene in gene_list},
                "ratios": {gene: ensure_json_serializable(gene_ratios[gene][i]) for gene in gene_list},
            }
            formatted_results.append(transformed_entry)
        
        return sample_id, formatted_results

    position_cell_ratios_dict = filter_and_merge(cell_list, gene_list, sample_ids)
    results = {}

    # Use parallel processing for multiple samples if beneficial
    if len(sample_ids) > 1 and len(position_cell_ratios_dict) > 1:
        # Parallel processing for multiple samples
        with Pool(processes=min(cpu_count(), len(sample_ids))) as pool:
            sample_results = pool.map(process_single_sample, position_cell_ratios_dict.items())
        
        # Convert to dictionary
        for sample_id, formatted_results in sample_results:
            results[sample_id] = formatted_results
    else:
        # Sequential processing for single sample or small datasets
        for sample_id, merged_df in position_cell_ratios_dict.items():
            sample_id, formatted_results = process_single_sample((sample_id, merged_df))
            results[sample_id] = formatted_results

    return results


def get_single_gene_expression_data(sample_ids, gene_name, cell_list=None):
    """
    Get single gene expression data for coloring cells based on expression values.
    
    Parameters:
    - sample_ids: List of sample IDs
    - gene_name: Single gene name
    - cell_list: List of cell IDs (optional)
    
    Returns:
    - Dictionary containing expression data for each sample with min/max values for normalization
    """
    results = {}
    
    for sample_id in sample_ids:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id not in SAMPLES:
            raise ValueError(f"Sample {base_sample_id} not found.")
        
        sample_info = SAMPLES[base_sample_id]
        if "scales" not in sample_info or scale not in sample_info["scales"]:
            raise ValueError(f"Scale {scale} not found for sample {base_sample_id}.")
        
        adata = get_cached_adata(sample_id)

        if not cell_list:
            valid_cell_ids = adata.obs_names.tolist()
        else:
            # Convert cell_ids to regular Python strings to avoid numpy string issues
            if hasattr(cell_list, '__iter__') and not isinstance(cell_list, str):
                cell_list = [str(cell_id) for cell_id in cell_list]
            else:
                cell_list = [str(cell_list)]
            
            valid_cell_ids = [
                cell for cell in cell_list if cell in adata.obs_names
            ]

        # Check if gene exists in the data
        if gene_name not in adata.var_names:
            # Return empty data if gene not found
            results[sample_id] = {
                "cells": [],
                "min_expression": 0,
                "max_expression": 0
            }
            continue

        # Extract expression data for the single gene
        filtered_adata = adata[valid_cell_ids, [gene_name]].copy()
        if issparse(filtered_adata.X):
            expr_data = filtered_adata.X.toarray().flatten()
        else:
            expr_data = filtered_adata.X.flatten()
        
        # Get coordinate data
        coord_df = get_coordinates_for_single_gene(sample_id, valid_cell_ids)
        
        # Create result data
        cell_data = []
        for i, cell_id in enumerate(valid_cell_ids):
            if i < len(coord_df):
                coord_row = coord_df.iloc[i]
                cell_data.append({
                    "id": cell_id,
                    "cell_x": coord_row.get("cell_x", 0),
                    "cell_y": coord_row.get("cell_y", 0),
                    "cell_type": coord_row.get("cell_type", "Unknown"),
                    "expression": float(expr_data[i])
                })
        
        # Calculate min and max expression values for normalization
        expression_values = [cell["expression"] for cell in cell_data]
        min_expr = min(expression_values) if expression_values else 0
        max_expr = max(expression_values) if expression_values else 0
        
        results[sample_id] = {
            "cells": cell_data,
            "min_expression": min_expr,
            "max_expression": max_expr
        }
    
    return results


def get_coordinates_for_single_gene(sample_id, cell_ids):
    """
    Helper function to get coordinates for single gene visualization
    """
    return single_sample_coordinates(sample_id, cell_ids=cell_ids, return_format='dataframe').reset_index(drop=True)


def get_umap_data(sample_id, cell_ids=None, n_neighbors=10, n_pcas=30, resolutions=1, adata_umap_title=None):
    """
    Generate UMAP data from gene expression data.

    Parameters:
    - sample_id: ID of the sample
    - cell_ids: List of cell IDs to filter the UMAP data
    - n_neighbors: Number of nearest neighbors to consider
    - n_pcas: Number of principal components to use
    - resolutions: Resolution parameter for Leiden clustering
    - adata_umap_title: Title of the UMAP analysis

    Returns:
    - Dictionary with 'status', 'message', and 'data' fields
    """
    try:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id not in SAMPLES:
            return {
                "status": "error",
                "message": f"Sample {base_sample_id} not found",
                "data": []
            }
        
        sample_info = SAMPLES[base_sample_id]
        if "scales" not in sample_info or scale not in sample_info["scales"]:
            return {
                "status": "error",
                "message": f"Scale {scale} not found for sample {base_sample_id}",
                "data": []
            }
        
        scale_info = sample_info["scales"][scale]
        
        if "adata_path" not in scale_info:
            return {
                "status": "error",
                "message": f"No gene expression data available for sample {sample_id}",
                "data": []
            }
        
        adata = get_cached_adata(sample_id)
        
        if cell_ids is not None:
            # Convert cell_ids to regular Python strings to avoid numpy string issues
            if hasattr(cell_ids, '__iter__') and not isinstance(cell_ids, str):
                cell_ids = [str(cell_id) for cell_id in cell_ids]
            else:
                cell_ids = [str(cell_ids)]
            
            # Filter to only valid cell IDs that exist in the adata
            # Convert adata.obs_names to strings for consistent comparison
            valid_obs_names = [str(x) for x in adata.obs_names]
            valid_cell_ids = [cell_id for cell_id in cell_ids if cell_id in valid_obs_names]
            
            if len(valid_cell_ids) == 0:
                return {
                    "status": "error",
                    "message": f"None of the provided cell_ids were found in the dataset",
                    "data": []
                }
            
            # Create a boolean mask for filtering
            mask = [str(x) in valid_cell_ids for x in adata.obs_names]
            adata = adata[mask].copy()
        else:
            return {
                "status": "error",
                "message": f"No cell_ids provided for sample {sample_id}",
                "data": []
            }

        sc.pp.filter_genes(adata, min_cells=5)
        sc.pp.filter_cells(adata, min_genes=50)

        if adata.n_obs < 50:
            return {
                "status": "error",
                "message": f"Too few cells for UMAP analysis",
                "data": []
            }
        
        if adata.n_vars < 50:
            return {
                "status": "error",
                "message": f"Too few genes for UMAP analysis",
                "data": []
            }

        # n_top_genes = min(1000, adata.n_vars)
        n_top_genes = 2000

        try:
            try:
                sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, flavor="seurat_v3")
            except ValueError as e:
                sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, flavor="cell_ranger")
        except Exception as e:
            print("HVG failed, using all genes")
            adata.var['highly_variable'] = True

        # sc.pp.normalize_total(adata)
        # sc.pp.log1p(adata)
        sc.pp.scale(adata, max_value=10)

        try:
            if issparse(adata.X):
                sparsity = 1 - (adata.X.nnz / (adata.X.shape[0] * adata.X.shape[1]))
            else:
                sparsity = 1 - (np.count_nonzero(adata.X) / (adata.X.shape[0] * adata.X.shape[1]))
            
            if sparsity > 0.99:
                print(f"Warning: Sample {sample_id} has very sparse data (sparsity: {sparsity:.3f})")
        except Exception as e:
            print(f"Warning: Could not calculate sparsity for sample {sample_id}: {e}")

        sc.tl.pca(adata, use_highly_variable=True)
        sc.pp.neighbors(adata, n_neighbors=n_neighbors, n_pcs=n_pcas)   
        sc.tl.umap(adata)    
        adata.obsm[f'X_umap_{adata_umap_title}'] = adata.obsm['X_umap'].copy()

        sc.tl.leiden(adata, resolution=resolutions, key_added=f'leiden_{adata_umap_title}')

        embedding = adata.obsm[f'X_umap_{adata_umap_title}']
        cluster_labels = adata.obs[f'leiden_{adata_umap_title}'].astype(int).values
        cell_ids_filtered = adata.obs_names.tolist()

        results = []
        for i in range(len(cell_ids_filtered)):
            results.append({
                'id': cell_ids_filtered[i],
                'x': float(embedding[i, 0]),
                'y': float(embedding[i, 1]),
                'cluster': f'Cluster {cluster_labels[i]}'
            })

        # Initialize nested dictionary if it doesn't exist
        if sample_id not in PROCESSED_ADATA_CACHE:
            PROCESSED_ADATA_CACHE[sample_id] = {}
        
        PROCESSED_ADATA_CACHE[sample_id][adata_umap_title] = adata

        return {
            "status": "success",
            "message": "UMAP analysis completed successfully",
            "data": results
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"Unexpected error during UMAP analysis: {str(e)}",
            "data": []
        }


def perform_go_analysis(sample_id, cluster_id, adata_umap_title, top_n=5):
    """
    Perform GO analysis on the selected cluster cells and return top GO terms.

    Parameters:
    - sample_id: ID of the sample
    - cluster_id: ID of the cluster
    - adata_umap_title: Title of the UMAP analysis
    - top_n: Number of top GO terms to return

    Returns:
    - List of top GO terms
    """

    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        raise ValueError(f"Scale {scale} not found for sample {base_sample_id}")
        
    scale_info = sample_info["scales"][scale]
    
    if "adata_path" in scale_info:
        # Get cached AnnData
        adata = get_processed_adata(sample_id, adata_umap_title)
        
        # Ensure the leiden column exists and is categorical for scanpy
        leiden_col = f'leiden_{adata_umap_title}'
        if leiden_col not in adata.obs.columns:
            raise ValueError(f"No clustering results found for {adata_umap_title}. Please generate UMAP first.")
        
        # Filter adata to only include cells that were part of this UMAP analysis
        # Cells that weren't part of the UMAP analysis have pd.NA values in the leiden column
        valid_cells = adata.obs[leiden_col].notna()
        adata_filtered = adata[valid_cells].copy()
        
        # Convert leiden column to categorical if it isn't already
        if not pd.api.types.is_categorical_dtype(adata_filtered.obs[leiden_col]):
            adata_filtered.obs[leiden_col] = adata_filtered.obs[leiden_col].astype('category')
        
        # Gene ranking
        sc.tl.rank_genes_groups(adata_filtered, groupby=leiden_col, method='wilcoxon')
        cluster_name = str(cluster_id)
        top_genes = adata_filtered.uns['rank_genes_groups']['names'][cluster_name][:100].tolist()

        # GO enrichment analysis
        gmt_path = os.path.join(BASE_DIR, "../Example_Data/GO_Biological_Process_2025.gmt")
        enr = gp.enrichr(gene_list=top_genes,
                    gene_sets=gmt_path,
                    organism='Human',
                    cutoff=0.05)
        
        # Results processing
        go_results = enr.results.sort_values(by='Combined Score', ascending=False)
        go_results.rename(columns={'Term': 'term', 'Adjusted P-value': 'adjusted_p_value', 'Combined Score': 'combined_score', 'P-value': 'p_value', "Genes": "genes", "Odds Ratio": "odds_ratio"}, inplace=True)
        top_df = go_results.head(top_n)

        return top_df.to_dict(orient='records')
    else:
        raise ValueError(f"No gene expression data available for sample {sample_id}")


def get_trajectory_gene_list(sample_id, is_vertical=False):
    """
    Get list of available genes from trajectory data for the given sample ID.

    Parameters:
    - sample_id: ID of the sample
    - is_vertical: Boolean flag indicating if the trajectory is vertical

    Returns:
    - List of available gene names
    """
    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        raise ValueError(f"Scale {scale} not found for sample {base_sample_id}")
    
    scale_info = sample_info["scales"][scale]
    
    # Select the appropriate trajectory data path based on is_vertical flag
    if is_vertical:
        trajectory_key = "vertical_non_random_gene_trajectory_expression_path"
    else:
        trajectory_key = "horizontal_non_random_gene_trajectory_expression_path"
    
    # Check if sample has the requested trajectory data
    if trajectory_key not in scale_info:
        data_type = "vertical" if is_vertical else "horizontal"
        raise ValueError(f"No {data_type} trajectory data available for sample {sample_id}")
    
    try:
        trajectory_path = scale_info[trajectory_key]
        df = pd.read_csv(trajectory_path, index_col=0)
        
        # Ensure variables column is string type
        df["variables"] = df["variables"].astype(str)
        
        # Return unique gene names
        gene_list = df["variables"].unique().tolist()
        return sorted(gene_list)
        
    except Exception as e:
        data_type = "vertical" if is_vertical else "horizontal"
        print(f"Error loading {data_type} trajectory gene list for sample {sample_id}: {e}")
        raise ValueError(f"Error loading {data_type} trajectory gene list: {str(e)}")


def get_trajectory_data(sample_id, selected_genes=None, is_vertical=False):
    """
    Get trajectory gene expression data for the given sample ID.

    Parameters:
    - sample_id: ID of the sample
    - selected_genes: List of gene names to filter the trajectory data
    - is_vertical: Boolean flag indicating if the trajectory is vertical

    Returns:
    - Dictionary containing trajectory data for each gene
    """
    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        raise ValueError(f"Scale {scale} not found for sample {base_sample_id}")
    
    scale_info = sample_info["scales"][scale]
    
    # Select the appropriate trajectory data path based on is_vertical flag
    if is_vertical:
        trajectory_key = "vertical_non_random_gene_trajectory_expression_path"
    else:
        trajectory_key = "horizontal_non_random_gene_trajectory_expression_path"
    
    # Check if sample has the requested trajectory data
    if trajectory_key not in scale_info:
        data_type = "vertical" if is_vertical else "horizontal"
        raise ValueError(f"No {data_type} trajectory data available for sample {sample_id}")
    
    try:
        trajectory_path = scale_info[trajectory_key]
        df = pd.read_csv(trajectory_path, index_col=0)
        
        columns_to_drop = ["colour", "PANEL", "group", "fill", "linewidth", "linetype", "weight", "alpha", "flipped_aes"]
        df = df.drop(columns=[col for col in columns_to_drop if col in df.columns], errors='ignore')

        df["variables"] = df["variables"].astype(str)

        if selected_genes:
            df = df[df["variables"].isin(selected_genes)]
        
        # Group data by gene (variables)
        trajectory_data = {}
        
        for gene in df["variables"].unique():
            gene_data = df[df["variables"] == gene].copy()
            gene_data = gene_data.sort_values("x")  # Sort by x for proper line plotting
            
            trajectory_data[gene] = {
                "gene": gene,
                "data": gene_data[["x", "y", "ymin", "ymax", "se"]].to_dict(orient="records")
            }
        
        return trajectory_data
        
    except Exception as e:
        data_type = "vertical" if is_vertical else "horizontal"
        print(f"Error loading {data_type} trajectory data for sample {sample_id}: {e}")
        raise ValueError(f"Error loading {data_type} trajectory data: {str(e)}")


def get_direct_slingshot_data(sample_id, cell_ids, adata_umap_title, start_cluster=None, n_neighbors=15, n_pcas=30, resolutions=1):
    """
    Get direct Slingshot analysis data with an optional start cluster.
    
    Parameters:
    - sample_id: ID of the sample
    - cell_ids: List of cell IDs to analyze
    - adata_umap_title: Title for the UMAP analysis
    - start_cluster: The cluster ID to use as the starting point for trajectory analysis (optional)
    - n_neighbors: Number of neighbors for neighbor graph construction (default: 15)
    - n_pcas: Number of principal components to use (default: 30)
    - resolutions: Resolution parameter for Leiden clustering (default: 1)
    """
    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        raise ValueError(f"Scale {scale} not found for sample {base_sample_id}")
    
    scale_info = sample_info["scales"][scale]
    
    if "adata_path" in scale_info:
        adata = get_processed_adata(sample_id, adata_umap_title)

        if cell_ids is not None:
            # Convert cell_ids to regular Python strings to avoid numpy string issues
            if hasattr(cell_ids, '__iter__') and not isinstance(cell_ids, str):
                # Handle lists, numpy arrays, pandas series, etc.
                cell_ids = [str(cell_id) for cell_id in cell_ids]
            else:
                cell_ids = [str(cell_ids)]
            
            # Filter to only valid cell IDs that exist in the adata
            # Convert adata.obs_names to strings for consistent comparison
            valid_obs_names = [str(x) for x in adata.obs_names]
            valid_cell_ids = [cell_id for cell_id in cell_ids if cell_id in valid_obs_names]
            
            if len(valid_cell_ids) == 0:
                raise ValueError("None of the provided cell_ids were found in the dataset")
            
            # Create a boolean mask for filtering
            mask = [str(x) in valid_cell_ids for x in adata.obs_names]
            adata = adata[mask].copy()
        else:
            raise ValueError(f"No gene expression data available for sample {sample_id}")
            
        # Check if adata is empty after filtering
        if adata.n_obs == 0:
            raise ValueError("No cells remaining after filtering. Please check your cell_ids parameter.")

        leiden_col = f'leiden_{adata_umap_title}'
        if not pd.api.types.is_categorical_dtype(adata.obs[leiden_col]):
            adata.obs[leiden_col] = adata.obs[leiden_col].astype('category')

        # Run direct Slingshot analysis with optional start cluster
        try:
            analysis_kwargs = {
                'adata': adata,
                'cluster_key': leiden_col,
                'embedding_key': f'X_umap_{adata_umap_title}'
            }
            
            if start_cluster is not None:
                analysis_kwargs['start_cluster'] = str(start_cluster)
            
            adata_with_slingshot, results = direct_slingshot_analysis(**analysis_kwargs)
            
            # Create cache key that matches frontend expectations
            # For manual mode (with start_cluster), use the same key format as frontend
            cache_key = f"{adata_umap_title}_cluster_{start_cluster}" if start_cluster is not None else adata_umap_title
            
            PROCESSED_ADATA_CACHE[sample_id][cache_key] = adata_with_slingshot
            
            # Store trajectory results in the cache for later use
            if 'trajectory_results' not in PROCESSED_ADATA_CACHE[sample_id]:
                PROCESSED_ADATA_CACHE[sample_id]['trajectory_results'] = {}
            PROCESSED_ADATA_CACHE[sample_id]['trajectory_results'][cache_key] = results

            # Get cluster order based on spatial enrichment analysis
            cluster_order = get_cluster_order_by_spatial_enrichment(adata_with_slingshot, adata_umap_title)
            
            return {
                'cluster_order': cluster_order,
                'trajectory_objects': results
            }
        
        except Exception as e:
            print(f"Direct Slingshot analysis failed: {e}")
            return None
    else:
        raise ValueError(f"No gene expression data available for sample {sample_id}")


def get_trajectory_gene_expression(sample_id, adata_umap_title, gene_names, trajectory_path):
    """
    Get gene expression data along a specific trajectory path using pre-calculated pseudotime values.
    
    Parameters:
    - sample_id: ID of the sample
    - adata_umap_title: Title for the UMAP analysis
    - gene_names: List of gene names to analyze
    - trajectory_path: List of cluster IDs representing the trajectory path
    
    Returns:
    - List of gene expression data objects
    """
    # Check if we have cached processed data
    if sample_id not in PROCESSED_ADATA_CACHE:
        raise ValueError(f"No cached data found for sample '{sample_id}'. Please run get_direct_slingshot_data first. Available samples: {list(PROCESSED_ADATA_CACHE.keys())}")
    
    # Look for the data using either the exact key or cluster-specific keys
    adata = None
    cache_key_used = None
    
    if adata_umap_title in PROCESSED_ADATA_CACHE[sample_id]:
        adata = PROCESSED_ADATA_CACHE[sample_id][adata_umap_title]
        cache_key_used = adata_umap_title
    else:
        # Look for cluster-specific keys that start with the adata_umap_title
        for key in PROCESSED_ADATA_CACHE[sample_id].keys():
            if key.startswith(f"{adata_umap_title}_cluster_"):
                adata = PROCESSED_ADATA_CACHE[sample_id][key]
                cache_key_used = key
                break
    
    if adata is None:
        raise ValueError(f"No cached trajectory data found for key '{adata_umap_title}' in sample '{sample_id}'. Please run get_direct_slingshot_data first. Available keys: {list(PROCESSED_ADATA_CACHE[sample_id].keys())}")
    
    print(f"Using cached data with key: {cache_key_used}")
    
    # Validate gene names
    if isinstance(gene_names, str):
        gene_names = [gene_names]
    
    available_genes = []
    for gene in gene_names:
        if gene in adata.var_names:
            available_genes.append(gene)
        else:
            print(f"Gene '{gene}' not found in dataset")
    
    if not available_genes:
        raise ValueError("No valid genes found in dataset")
    
    # Get the leiden column name
    leiden_col = f'leiden_{adata_umap_title}'
    if leiden_col not in adata.obs.columns:
        # Try to find any leiden column
        leiden_cols = [col for col in adata.obs.columns if col.startswith('leiden')]
        if leiden_cols:
            leiden_col = leiden_cols[0]
        else:
            raise ValueError("No leiden clustering column found in the dataset")
    
    # Try to get trajectory results from cache first (preferred method)
    trajectory_results = None
    if 'trajectory_results' in PROCESSED_ADATA_CACHE[sample_id] and cache_key_used in PROCESSED_ADATA_CACHE[sample_id]['trajectory_results']:
        trajectory_results = PROCESSED_ADATA_CACHE[sample_id]['trajectory_results'][cache_key_used]
        print(f"Using cached trajectory results for pseudotime values with key: {cache_key_used}")
    
    if trajectory_results and isinstance(trajectory_results, list) and len(trajectory_results) > 0:
        # Use the first trajectory result (you might want to make this configurable)
        trajectory_result = trajectory_results[0]
        
        # Extract cluster path and pseudotime values
        if 'path' in trajectory_result and 'pseudotime' in trajectory_result:
            cluster_path = trajectory_result['path']
            pseudotime_values = trajectory_result['pseudotime']
        elif 'correction_info' in trajectory_result:
            # Use corrected pseudotime if available
            cluster_path = trajectory_result['correction_info']['trajectory_path']
            pseudotime_values = trajectory_result['correction_info']['corrected_pseudotime']
        else:
            print("Warning: No valid trajectory path or pseudotime data found in cached results")
            trajectory_results = None
        
        if trajectory_results:
            # Create a mapping from cluster to pseudotime
            cluster_pseudotime_map = {}
            for cluster, pseudotime in zip(cluster_path, pseudotime_values):
                cluster_pseudotime_map[str(cluster)] = pseudotime
    
    # Fallback: Try to find pseudotime data in the AnnData object
    if not trajectory_results:
        available_pseudotime_cols = [col for col in adata.uns.keys() if col.startswith("slingshot_pseudotime")]
        
        if available_pseudotime_cols:
            # Use the first available pseudotime column
            pseudotime_col = available_pseudotime_cols[0]
            if len(available_pseudotime_cols) > 1:
                # Try to find Lineage1 first
                lineage1_cols = [col for col in available_pseudotime_cols if "Lineage1" in col]
                if lineage1_cols:
                    pseudotime_col = lineage1_cols[0]
            
            print(f"Using pseudotime column: {pseudotime_col}")
            pseudotime_values = adata.uns[pseudotime_col]
            
            # Create a mapping from cluster to pseudotime
            cluster_pseudotime_map = {}
            cluster_labels = adata.obs[leiden_col].astype(str)
            
            for i, cluster in enumerate(cluster_labels):
                if cluster not in cluster_pseudotime_map:
                    cluster_pseudotime_map[cluster] = []
                cluster_pseudotime_map[cluster].append(pseudotime_values[i])
            
            # Calculate mean pseudotime for each cluster
            for cluster in cluster_pseudotime_map:
                cluster_pseudotime_map[cluster] = np.mean(cluster_pseudotime_map[cluster])
        
        else:
            # If no slingshot pseudotime data, try to use the trajectory_path order as a proxy
            # This is a fallback that assumes the trajectory_path order represents temporal progression
            print("No slingshot pseudotime data found. Using trajectory path order as temporal proxy.")
            cluster_pseudotime_map = {}
            for i, cluster in enumerate(trajectory_path):
                cluster_pseudotime_map[str(cluster)] = float(i)
    
    # Analyze gene expression along the trajectory
    result_data = []
    
    for gene in available_genes:
        # Get gene expression data
        gene_idx = adata.var_names.get_loc(gene)
        
        # Get expression values for all cells
        if hasattr(adata.X, "toarray"):
            gene_expr = adata.X[:, gene_idx].toarray().flatten()
        else:
            gene_expr = adata.X[:, gene_idx]
        
        # Get cluster labels
        cluster_labels = adata.obs[leiden_col].astype(str)
        
        # Calculate mean expression for each cluster in the trajectory
        time_points = []
        expression_values = []
        
        for cluster in trajectory_path:
            cluster_str = str(cluster)
            if cluster_str in cluster_pseudotime_map:
                cluster_cells = cluster_labels == cluster_str
                if cluster_cells.sum() > 0:
                    # Get gene expression for this cluster
                    cluster_expr = gene_expr[cluster_cells]
                    mean_expr = float(np.mean(cluster_expr))
                    time_point = cluster_pseudotime_map[cluster_str]
                    
                    time_points.append(time_point)
                    expression_values.append(mean_expr)
        
        # Sort by time points
        if len(time_points) > 1:
            sorted_indices = np.argsort(time_points)
            time_points = [time_points[i] for i in sorted_indices]
            expression_values = [expression_values[i] for i in sorted_indices]
        
        # Normalize expression values to [0, 1] range
        if len(expression_values) > 0:
            min_expr = min(expression_values)
            max_expr = max(expression_values)
            if max_expr > min_expr:
                normalized_expr = [(expr - min_expr) / (max_expr - min_expr) for expr in expression_values]
            else:
                normalized_expr = [0.5] * len(expression_values)  # All same value, set to middle
        else:
            normalized_expr = []
        
        gene_data = {
            "gene": gene,
            "timePoints": time_points,
            "expressions": normalized_expr
        }
        result_data.append(gene_data)
    
    return result_data


def get_cluster_order_by_spatial_enrichment(adata, adata_umap_title):
    """
    Get cluster order based on spatial enrichment analysis using spatial coherence ranking.
    
    Parameters:
    - adata: AnnData object
    - adata_umap_title: Title of the UMAP analysis
    
    Returns:
    - List of cluster names in order of spatial coherence
    """
    # Check if we have leiden clustering results for this UMAP
    leiden_col = f'leiden_{adata_umap_title}'
    if leiden_col not in adata.obs.columns:
        print(f"No leiden clustering found for {adata_umap_title}")
        return []
    
    # Check if spatial neighbors and enrichment analysis already exists
    enrichment_key = f'{leiden_col}_nhood_enrichment'
    if enrichment_key not in adata.uns:
        # Perform spatial neighbors analysis
        if sq is None:
            print("Squidpy not available, cannot perform spatial enrichment analysis")
            return []
        try:
            sq.gr.spatial_neighbors(adata)
            sq.gr.nhood_enrichment(adata, cluster_key=leiden_col)
        except Exception as e:
            print(f"Error performing spatial enrichment analysis: {e}")
            return []
    
    # Get enrichment results
    nhood_results = adata.uns[enrichment_key]
    if 'zscore' not in nhood_results:
        print("No Z-score results found in enrichment analysis")
        return []
    
    enrichment_results = nhood_results['zscore']
    cluster_names = sorted(adata.obs[leiden_col].unique())
    
    if len(cluster_names) == 0:
        print(f"No clusters found in {leiden_col}")
        return []

    def rank_by_significant_interactions(enrichment_matrix, cluster_names, zscore_threshold=2.0):
        """Sorting based on the number of significant positive interactions (excluding diagonal)"""
        if isinstance(enrichment_matrix, pd.DataFrame):
            matrix = enrichment_matrix.values
            names = enrichment_matrix.index.tolist()
        else:
            matrix = enrichment_matrix
            names = cluster_names
        
        results = []
        
        for i, cluster in enumerate(names):
            # Get the row for this cluster (interactions with other clusters)
            interactions = matrix[i, :]
            
            # Exclude diagonal (self-interactions) by setting to 0
            interactions_no_diag = interactions.copy()
            interactions_no_diag[i] = 0
            
            # Only consider positive interactions above threshold
            significant_positive = (interactions_no_diag > zscore_threshold).sum()
            
            # Get max positive interaction (excluding diagonal)
            max_zscore = interactions_no_diag.max()
            
            results.append({
                'cluster': cluster,
                'positive_interactions': significant_positive,
                'max_zscore': max_zscore
            })
        
        return pd.DataFrame(results).sort_values('positive_interactions', ascending=False)
    
    # Sort clusters by spatial coherence
    sorted_clusters = rank_by_significant_interactions(enrichment_results, cluster_names)

    # Get just the cluster names in order
    cluster_order = sorted_clusters['cluster'].tolist()
    
    return cluster_order


def convert_arrow_width_to_16um_pixels(sample_id, arrow_width_frontend_pixels):
    """
    Convert arrow width from frontend display pixels to 16µm VisiumHD pixels.
    
    Parameters:
    - sample_id: ID of the sample (e.g., "skin_TXK6Z4X_A1_2um")
    - arrow_width_frontend_pixels: Arrow width in frontend display pixels
    
    Returns:
    - Arrow width in 16µm VisiumHD pixels
    """
    # Parse sample ID to get base sample and current scale
    base_sample_id, current_scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or current_scale not in sample_info["scales"]:
        raise ValueError(f"Scale {current_scale} not found for sample {base_sample_id}")
    
    # Load the current scale adata to get scale factor
    current_adata = get_cached_adata(sample_id)
    if current_adata is None:
        raise ValueError(f"Could not load adata for sample {sample_id}")
    
    # Get scale factor from current scale b2c data
    IMG_KEY = "0.5_mpp_150_buffer"
    
    def get_library_key(adata):
        return list(adata.uns["spatial"].keys())[0]

    def get_scalefactor_from_b2c(adata, img_key):
        lib = get_library_key(adata)
        key = f"tissue_{img_key}_scalef"
        return float(adata.uns["spatial"][lib]["scalefactors"][key])
    
    # Get scale factor for current scale
    current_scale_factor = get_scalefactor_from_b2c(current_adata, IMG_KEY)
    
    # Convert frontend pixels to full-resolution pixels
    arrow_width_fullres_pixels = arrow_width_frontend_pixels / current_scale_factor
    
    # Construct path to 16µm scalefactors
    python_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Example_Data")
    scalefactors_16um_path = os.path.join(
        python_dir, 
        f"{base_sample_id}", 
        "binned_outputs", 
        "square_016um", 
        "spatial", 
        "scalefactors_json.json"
    )
    
    try:
        import json
        with open(scalefactors_16um_path, 'r') as f:
            scalefactors_16um = json.load(f)
        
        # Get the scale factor for tissue_lowres_image
        # tissue_lowres_scalef represents the ratio: lowres_image_pixel / fullres_pixel
        tissue_lowres_scalef = scalefactors_16um.get("tissue_lowres_scalef", None)
        tissue_hires_scalef = scalefactors_16um.get("tissue_hires_scalef", None)
        
        if tissue_lowres_scalef is None:
            raise ValueError("tissue_lowres_scalef not found in 16µm scalefactors")
        
        # Convert full-resolution pixels to 16µm lowres pixels
        # This is the pixel space that matches the 16µm tissue_positions.parquet coordinates
        arrow_width_16um_pixels = arrow_width_fullres_pixels * tissue_lowres_scalef
        
        return {
            "arrow_width_16um_lowres_pixels": arrow_width_16um_pixels,
            "arrow_width_16um_hires_pixels": arrow_width_fullres_pixels * tissue_hires_scalef if tissue_hires_scalef else None,
            "arrow_width_fullres_pixels": arrow_width_fullres_pixels,
            "conversion_info": {
                "current_scale": current_scale,
                "current_scale_factor": current_scale_factor,
                "tissue_lowres_scalef_16um": tissue_lowres_scalef,
                "tissue_hires_scalef_16um": tissue_hires_scalef,
                "scalefactors_path": scalefactors_16um_path
            }
        }
        
    except Exception as e:
        raise ValueError(f"Error reading 16µm scalefactors: {str(e)}")


def convert_coordinates_to_16um_lowres(sample_id, coordinates):
    """
    Convert coordinates from current scale to 16µm tissue_lowres_image space.
    
    The conversion process:
    1. Current scale coordinates → full-resolution coordinates  
    2. Full-resolution coordinates → 16µm lowres coordinates
    
    Parameters:
    - sample_id: Sample ID (e.g., "skin_TXK6Z4X_A1_2um")
    - coordinates: List of [x, y] coordinates in current scale space
    
    Returns:
    - Dictionary with original and converted coordinates
    """
    # Parse sample ID
    base_sample_id, current_scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info:
        raise ValueError(f"No scales found for sample {base_sample_id}")
    
    # Get current scale info
    if current_scale not in sample_info["scales"]:
        raise ValueError(f"Scale {current_scale} not found for sample {base_sample_id}")
    
    # Get 16µm scale info  
    if "16um" not in sample_info["scales"]:
        raise ValueError(f"16µm scale not found for sample {base_sample_id}")
    
    try:
        # Load current scale adata
        current_adata = get_cached_adata(sample_id)
        if current_adata is None:
            raise ValueError(f"Could not load adata for sample {sample_id}")
        
        # Get scale factor and crop offset from current scale
        IMG_KEY = "0.5_mpp_150_buffer"
        CROPPED_KEY = "spatial_cropped_150_buffer"
        
        lib_key = list(current_adata.uns["spatial"].keys())[0]
        current_scalef = float(current_adata.uns["spatial"][lib_key]["scalefactors"][f"tissue_{IMG_KEY}_scalef"])
        
        # Get crop offset
        if CROPPED_KEY not in current_adata.obsm:
            raise KeyError(f"Could not find {CROPPED_KEY}, please check b2c output.")
        S_full = np.asarray(current_adata.obsm["spatial"], dtype=float)
        S_crop = np.asarray(current_adata.obsm[CROPPED_KEY], dtype=float)
        D = S_full - S_crop
        x0 = float(np.median(D[:,0]))
        y0 = float(np.median(D[:,1]))
        
        # Load 16µm scalefactors
        python_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Example_Data")
        scalefactors_16um_path = os.path.join(python_dir, base_sample_id, "binned_outputs", "square_016um", "spatial", "scalefactors_json.json")
        
        with open(scalefactors_16um_path, 'r') as f:
            scalefactors_16um = json.load(f)
        
        # Get 16µm scale factor for tissue_lowres_image
        tissue_lowres_scalef_16um = float(scalefactors_16um["tissue_lowres_scalef"])
        
        # Convert coordinates
        coords_array = np.asarray(coordinates, dtype=float)
        
        # Step 1: Convert current scale coordinates to full-resolution coordinates
        coords_fullres = np.column_stack([
            x0 + coords_array[:,0] / current_scalef,
            y0 + coords_array[:,1] / current_scalef
        ])
        
        # Step 2: Convert full-resolution coordinates to 16µm lowres coordinates
        coords_16um_lowres = coords_fullres * tissue_lowres_scalef_16um
        
        return {
            "original_coordinates": coordinates,
            "fullres_coordinates": coords_fullres.tolist(),
            "coords_16um_lowres": coords_16um_lowres.tolist(),
            "conversion_details": {
                "current_scale": current_scale,
                "current_scalef": current_scalef,
                "crop_offset": {"x0": x0, "y0": y0},
                "tissue_lowres_scalef_16um": tissue_lowres_scalef_16um
            }
        }
        
    except Exception as e:
        raise ValueError(f"Error converting coordinates: {str(e)}")


def analyze_trajectory(sample_id, start_coordinates, end_coordinates, arrow_width_pixels, drawing_points, trajectory_name, area_name=None):
    """
    Analyze trajectory using multi-scale matching method from Jupyter notebook.
    Maps coordinates from processed image to full-resolution, finds 16um barcodes,
    and runs SPATA2 R analysis to get trajectory gene expression data.

    Parameters:
    - sample_id: ID of the sample (e.g., "skin_TXK6Z4X_A1_2um")
    - start_coordinates: [x, y] start coordinates in processed image space
    - end_coordinates: [x, y] end coordinates in processed image space
    - arrow_width_pixels: Width of the trajectory arrow in pixels
    - drawing_points: List of [x, y] points defining the ROI polygon
    - trajectory_name: User-defined name for the trajectory
    - area_name: User-defined name for the region/area (optional)

    Returns:
    - Dictionary containing analysis results with mapped coordinates, 16um barcodes, and trajectory data
    """
    # Parse sample ID to get base sample and scale
    base_sample_id, scale = sample_id.rsplit("_", 1)
    if base_sample_id not in SAMPLES:
        raise ValueError(f"Sample {base_sample_id} not found")
    
    sample_info = SAMPLES[base_sample_id]
    if "scales" not in sample_info or scale not in sample_info["scales"]:
        raise ValueError(f"Scale {scale} not found for sample {base_sample_id}")
    
    scale_info = sample_info["scales"][scale]
    
    # Load the appropriate scale adata
    adata = get_cached_adata(sample_id)
    if adata is None:
        raise ValueError(f"Could not load adata for sample {sample_id}")
    
    # Constants from the notebook
    IMG_KEY = "0.5_mpp_150_buffer"
    CROPPED_KEY = "spatial_cropped_150_buffer"
    
    # Helper functions from the notebook
    def get_library_key(adata):
        return list(adata.uns["spatial"].keys())[0]

    def get_scalefactor_from_b2c(adata, img_key):
        lib = get_library_key(adata)
        key = f"tissue_{img_key}_scalef"
        return float(adata.uns["spatial"][lib]["scalefactors"][key])

    def recover_crop_offset_xy0(adata, cropped_key="spatial_cropped_150_buffer", spatial_key="spatial"):
        if cropped_key not in adata.obsm:
            raise KeyError(f"Could not find {cropped_key}, please check b2c output.")
        S_full = np.asarray(adata.obsm[spatial_key], dtype=float)
        S_crop = np.asarray(adata.obsm[cropped_key], dtype=float)
        D = S_full - S_crop
        x0 = float(np.median(D[:,0]))
        y0 = float(np.median(D[:,1]))
        return x0, y0

    def processed_to_fullres(points_uv, x0, y0, scalef):
        """Convert processed coordinates to full-resolution coordinates"""
        arr = np.asarray(points_uv, dtype=float)
        xs = x0 + arr[:,0] / scalef
        ys = y0 + arr[:,1] / scalef
        return np.column_stack([xs, ys])

    def select_barcodes_in_polygon(tissue_positions_parquet, polygon_fullres_xy):
        """Select barcodes that fall within the given polygon"""
        try:
            df = pd.read_parquet(tissue_positions_parquet).copy()
            df = df.loc[(df["pxl_row_in_fullres"] >= 0) & (df["pxl_col_in_fullres"] >= 0)]
            pts = np.column_stack([
                df["pxl_col_in_fullres"].to_numpy(dtype=float),
                df["pxl_row_in_fullres"].to_numpy(dtype=float),
            ])
            poly_path = Path(polygon_fullres_xy)
            inside = poly_path.contains_points(pts)
            
            # Find barcode column
            bc_col = "barcode" if "barcode" in df.columns else \
                     "Barcode" if "Barcode" in df.columns else \
                     "barcodes" if "barcodes" in df.columns else \
                     "spot_id" if "spot_id" in df.columns else \
                     "barcode_id" if "barcode_id" in df.columns else None
            if bc_col is None:
                raise KeyError(f"Could not find barcode column, existing columns: {list(df.columns)[:20]} ...")

            out = df.loc[inside, [bc_col, "pxl_col_in_fullres", "pxl_row_in_fullres"]].copy()
            out = out.rename(columns={
                bc_col: "barcode",
                "pxl_col_in_fullres": "x_fullres",
                "pxl_row_in_fullres": "y_fullres",
            })
            return out
        except Exception as e:
            print(f"Error reading parquet file: {e}")
            return pd.DataFrame(columns=["barcode", "x_fullres", "y_fullres"])
    
    try:
        # Get scale factor and crop offset from b2c (same for both ROI and arrow transformations)
        s = get_scalefactor_from_b2c(adata, IMG_KEY)
        x0, y0 = recover_crop_offset_xy0(adata, CROPPED_KEY, "spatial")
        
        # Map ROI drawing points to full-resolution for barcode selection
        roi_fullres = processed_to_fullres(drawing_points, x0, y0, s)
        
        # Map arrow coordinates using the same transformation chain as ROI
        trajectory_points = [start_coordinates, end_coordinates]
        trajectory_fullres = processed_to_fullres(trajectory_points, x0, y0, s)
        
        # Convert frontend pixels to full-resolution pixels using the same scale factor
        arrow_width_fullres_pixels = arrow_width_pixels / s
        
        # Load 16µm scalefactors to convert fullres coordinates to 16µm lowres space
        python_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Example_Data")
        scalefactors_16um_path = os.path.join(python_dir, base_sample_id, "binned_outputs", "square_016um", "spatial", "scalefactors_json.json")
        
        with open(scalefactors_16um_path, 'r') as f:
            scalefactors_16um = json.load(f)
        
        tissue_lowres_scalef_16um = float(scalefactors_16um["tissue_lowres_scalef"])
        
        # Convert trajectory fullres coordinates to 16µm lowres coordinates
        trajectory_16um_lowres = trajectory_fullres * tissue_lowres_scalef_16um
        start_16um_lowres = trajectory_16um_lowres[0].tolist()
        end_16um_lowres = trajectory_16um_lowres[1].tolist()
        
        # Convert arrow width from full-resolution to 16µm lowres pixels
        arrow_width_16um_pixels = arrow_width_fullres_pixels * tissue_lowres_scalef_16um
        
        # Find the 16um parquet file path
        # Construct the expected path for 16um tissue positions
        tgt_16um_parquet = os.path.join(python_dir, f"{base_sample_id}", "binned_outputs", "square_016um", "spatial", "tissue_positions.parquet")
        
        # Select barcodes within the ROI polygon
        bc16 = select_barcodes_in_polygon(tgt_16um_parquet, roi_fullres)
        
        # Run SPATA2 analysis
        spata2_results = run_spata2_analysis(
            base_sample_id, 
            bc16.to_dict('records') if len(bc16) > 0 else [],
            start_16um_lowres, 
            end_16um_lowres, 
            arrow_width_16um_pixels,
            trajectory_name
        )
        
        result = {
            "status": "success",
            # "barcode": bc16.to_dict('records'),
            # "points":{
            #     "start_16um_lowres": start_16um_lowres,
            #     "end_16um_lowres": end_16um_lowres,
            #     "arrow_width_16um_pixels": arrow_width_16um_pixels,
            # },
            "spata2_analysis": spata2_results if spata2_results else {
                "trajectory_data": [],
                "significant_genes": [],
                "trajectory_id": None
            }
        }
        
        # Store the result in the cache for later retrieval by the cascade selectors
        # Use area_name as the region identifier, fallback to trajectory-based name if not provided
        if spata2_results:
            # Use the provided area_name as the region, or create a default if not provided
            region_name = area_name if area_name else f"Region_{trajectory_name}" if trajectory_name else "Default_Region"
            store_trajectory_analysis(sample_id, region_name, trajectory_name, result)
        else:
            print(f"No SPATA2 results to store for trajectory {trajectory_name}")
        
        return result
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"Error analyzing trajectory: {str(e)}",
            "sample_id": sample_id
        }


def get_highly_variable_genes(sample_ids, cell_ids=None, top_n=20):
    """
    Get top N highly variable genes for each sample based on cells within a specific ROI.
    
    Parameters:
    - sample_ids: List of sample IDs
    - cell_ids: List of cell IDs within the ROI to analyze. If None, analyze entire sample.
    - top_n: Number of top genes to return per sample (default: 20). If None, 'all', or <= 0, return all genes.
    
    Returns:
    - Dictionary with sample_id as keys and list of highly variable genes as values
    """
    result = {}
    
    for sample_id in sample_ids:
        base_sample_id, scale = sample_id.rsplit("_", 1)
        if base_sample_id not in SAMPLES:
            continue
            
        sample_info = SAMPLES[base_sample_id]
        if "scales" not in sample_info or scale not in sample_info["scales"]:
            continue
            
        scale_info = sample_info["scales"][scale]
        
        if "adata_path" in scale_info:
            try:
                # Get cached AnnData
                adata = get_cached_adata(sample_id)
                
                # Filter adata to ROI cells if cell_ids are provided
                if cell_ids is not None:
                    # Convert cell_ids to regular Python strings to avoid numpy string issues
                    if hasattr(cell_ids, '__iter__') and not isinstance(cell_ids, str):
                        cell_ids_str = [str(cell_id) for cell_id in cell_ids]
                    else:
                        cell_ids_str = [str(cell_ids)]
                    
                    # Filter to valid cell IDs that exist in the dataset
                    valid_cell_ids = [cell for cell in cell_ids_str if cell in adata.obs_names]
                    
                    if len(valid_cell_ids) == 0:
                        print(f"No valid cell IDs found in ROI for sample {sample_id}")
                        result[sample_id] = []
                        continue
                    
                    # Subset adata to ROI cells
                    adata_roi = adata[valid_cell_ids].copy()
                    
                    # Check if ROI has sufficient cells for analysis
                    if adata_roi.n_obs < 10:
                        print(f"ROI for sample {sample_id} has too few cells ({adata_roi.n_obs}) for meaningful analysis")
                        result[sample_id] = []
                        continue
                else:
                    adata_roi = adata.copy()
                
                # If caller requests all genes, bypass HVG selection
                if top_n is None or (isinstance(top_n, str) and str(top_n).lower() == 'all') or (isinstance(top_n, int) and top_n <= 0):
                    result[sample_id] = adata_roi.var_names.tolist()
                else:
                    # Calculate highly variable genes on the ROI subset
                    # Use a lower n_top_genes if we have fewer genes than usual
                    n_top_genes = min(2000, adata_roi.n_vars // 2) if adata_roi.n_vars < 4000 else 2000
                    
                    sc.pp.filter_genes(adata, min_cells=1)
                    sc.pp.filter_cells(adata, min_genes=50)
                    
                    # Calculate highly variable genes for the ROI
                    try:
                        if 'counts' in adata.layers:
                            sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, layer='counts', flavor="seurat_v3")
                        else:
                            sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, flavor="seurat")
                    except Exception:
                            sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, flavor="cell_ranger")
                    
                    # Get highly variable genes
                    if 'highly_variable' in adata_roi.var.columns:
                        hvg_mask = adata_roi.var['highly_variable']
                        hvg_genes = adata_roi.var_names[hvg_mask]
                        
                        # Sort by variance if available, otherwise just take first N
                        if 'highly_variable_rank' in adata_roi.var.columns:
                            hvg_df = adata_roi.var[hvg_mask].sort_values('highly_variable_rank')
                            top_genes = hvg_df.index[:int(top_n)].tolist()
                        else:
                            top_genes = hvg_genes[:int(top_n)].tolist()
                        
                        result[sample_id] = top_genes
                    else:
                        result[sample_id] = adata_roi.var_names[:int(top_n)].tolist()
                    
            except Exception as e:
                print(f"Error getting highly variable genes for sample {sample_id}: {e}")
                result[sample_id] = []
        else:
            result[sample_id] = []
    
    return result