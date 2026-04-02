"""
Slingshot Trajectory and Gene Analysis Module
"""

import pandas as pd
import numpy as np
import subprocess
from scipy import sparse
import warnings
import rpy2.robjects as ro
from rpy2.robjects.packages import importr
from rpy2.robjects import pandas2ri
from rpy2.robjects.conversion import localconverter
import tempfile
import os
from scipy import stats

warnings.filterwarnings("ignore")


def check_r_availability():
    """
    Check if R and required packages are available for Slingshot analysis.
    """
    availability = {
        "rpy2": False,
        "r_installed": False,
        "slingshot_package": False,
        "singlecellexperiment_package": False,
        "errors": []
    }
    
    # Check RPy2
    try:
        availability["rpy2"] = True
    except ImportError:
        availability["errors"].append("RPy2 not installed. Install with: pip install rpy2")
        return availability

    with localconverter(ro.default_converter + pandas2ri.converter):
        # Check R installation
        try:
            base = importr("base")
            availability["r_installed"] = True
        except Exception as e:
            availability["errors"].append(f"R not available: {e}")
            return availability
        
        # Check BiocManager
        try:
            biocmanager = importr("BiocManager")
            availability["biocmanager"] = True
        except Exception as e:
            availability["errors"].append(f"BiocManager not available: {e}")
        
        # Check Slingshot package
        try:
            slingshot = importr("slingshot")
            availability["slingshot_package"] = True
        except Exception as e:
            availability["errors"].append(f"Slingshot package not available: {e}")
        
        # Check SingleCellExperiment package
        try:
            sce = importr("SingleCellExperiment")
            availability["singlecellexperiment_package"] = True
        except Exception as e:
            availability["errors"].append(f"SingleCellExperiment package not available: {e}")
    
    return availability


def run_slingshot(
    adata,
    cluster_key="leiden",
    embedding_key="X_umap",
    start_cluster=None,
    end_clusters=None,
):
    """
    Run Slingshot analysis with improved error handling and fallback mechanisms.

    Parameters
    ----------
    adata : AnnData
        The annotated data matrix with Slingshot results
    cluster_key : str
        The key in adata.obs for cluster labels
    embedding_key : str
        The key in adata.obsm for reduced dimension coordinates
    start_cluster : str
        The starting cluster for trajectory analysis
    end_clusters : list of str
        The end clusters for trajectory analysis

    Returns:
    -------
    AnnData : The annotated data matrix with Slingshot results
    """
    # Check R availability first
    availability = check_r_availability()

    if not availability["rpy2"] or not availability["r_installed"]:
        print("R/RPy2 not available, trying subprocess fallback...")
        return run_slingshot_by_subprocess(adata, cluster_key, embedding_key, start_cluster, end_clusters)
    
    # Try RPy2 first, then fallback to subprocess if needed
    result = run_slingshot_by_rpy2(adata, cluster_key, embedding_key, start_cluster, end_clusters)
    if result is not None:
        return result
    
    print("RPy2 method failed, trying subprocess fallback...")
    return run_slingshot_by_subprocess(adata, cluster_key, embedding_key, start_cluster, end_clusters)


def run_slingshot_by_rpy2(
    adata,
    cluster_key="leiden",
    embedding_key="X_umap",
    start_cluster=None,
    end_clusters=None,
):
    """
    Run Slingshot using RPy2 with proper context management.

    Parameters
    ----------
    adata : AnnData
        The annotated data matrix with Slingshot results
    cluster_key : str
        The key in adata.obs for cluster labels
    embedding_key : str
        The key in adata.obsm for reduced dimension coordinates
    start_cluster : str
        The starting cluster for trajectory analysis
    end_clusters : list of str
        The end clusters for trajectory analysis

    Returns:
    -------
    AnnData : The annotated data matrix with Slingshot results
    """
    try:
        with localconverter(ro.default_converter + pandas2ri.converter):
            # Import R packages with error handling
            try:
                base = importr("base")
                utils = importr("utils")
                print("Successfully imported R packages.")
            except Exception as import_error:
                print(f"Error importing R packages: {import_error}")
                return None

            # Creating temporary directory
            with tempfile.TemporaryDirectory() as temp_dir:
                print("Creating temporary files...")

                # Export to CSV files with proper error handling.
                # CSV avoids pyarrow/arrow shared-library conflicts in long-lived sessions.
                try:
                    if sparse.issparse(adata.X):
                        expr_df = pd.DataFrame(adata.X.toarray())
                    else:
                        expr_df = pd.DataFrame(adata.X)

                    umap_df = pd.DataFrame(
                        adata.obsm[embedding_key], columns=["UMAP1", "UMAP2"]
                    )
                    clusters_df = pd.DataFrame({"clusters": adata.obs[cluster_key].astype(str)})

                    expr_file = os.path.join(temp_dir, "expr.csv")
                    umap_file = os.path.join(temp_dir, "umap.csv")
                    clusters_file = os.path.join(temp_dir, "clusters.csv")

                    expr_df.to_csv(expr_file, index=False)
                    umap_df.to_csv(umap_file, index=False)
                    clusters_df.to_csv(clusters_file, index=False)
                except Exception as file_error:
                    print(f"Error creating temporary files: {file_error}")
                    return None

                print("Reading data and running analysis in R...")

                # Build R command with better error handling
                r_cmd = f"""
                # Error handling wrapper
                tryCatch({{
                    # Import and load packages
                    if (!requireNamespace("BiocManager", quietly = TRUE))
                        install.packages("BiocManager")
                    
                    required_packages <- c("slingshot", "SingleCellExperiment")
                    for (pkg in required_packages) {{
                        if (!requireNamespace(pkg, quietly = TRUE)) {{
                            BiocManager::install(pkg)
                        }}
                    }}
                    
                    library(slingshot)
                    library(SingleCellExperiment)
                    
                    # Load data
                    expr_matrix <- as.matrix(read.csv(\"{expr_file}\", check.names = FALSE))
                    umap_coords <- as.matrix(read.csv(\"{umap_file}\", check.names = FALSE))
                    clusters <- read.csv(\"{clusters_file}\", check.names = FALSE)$clusters
                    
                    # Transpose gene expression matrix (gene x cell)
                    expr_matrix <- t(expr_matrix)

                    # Create SingleCellExperiment object
                    sce <- SingleCellExperiment(
                        assays = list(counts = expr_matrix)
                    )
                    
                    # Add UMAP and cluster info
                    reducedDims(sce) <- list(UMAP = umap_coords)
                    colData(sce)$clusters <- clusters
                    
                    # Run Slingshot
                """

                # Start and End cluster parameters (Optional)
                if start_cluster is not None:
                    r_cmd += f'start_clus <- \"{start_cluster}\"\n'
                    r_cmd += 'sce <- slingshot(sce, clusterLabels = "clusters", reducedDim = "UMAP", start.clus = start_clus)\n'
                else:
                    r_cmd += 'sce <- slingshot(sce, clusterLabels = "clusters", reducedDim = "UMAP")\n'

                r_cmd += f"""
                    # Get result
                    pseudotimes <- slingPseudotime(sce)
                    lineages <- slingLineages(sce)

                    # Convert matrix to data frame for CSV writing
                    pseudotimes_df <- as.data.frame(pseudotimes)
                    # Add row names as a column to preserve cell identifiers
                    pseudotimes_df <- cbind(CellID = rownames(pseudotimes_df), pseudotimes_df)
                    write.csv(pseudotimes_df, "{temp_dir}/pseudotimes.csv", row.names = FALSE)

                    # lineage list
                    lineages_df <- data.frame(
                        Lineage = rep(names(lineages), lengths(lineages)),
                        Cluster = unlist(lineages)
                    )
                    write.csv(lineages_df, "{temp_dir}/lineages.csv", row.names = FALSE)
                    
                    # Return number of trajectories
                    n_lineages <- ncol(pseudotimes)
                    cat("Found", n_lineages, "trajectories\\n")
                    
                }}, error = function(e) {{
                    cat("R Error:", conditionMessage(e), "\\n")
                }})
                """

                # Execute R with proper context management
                try:
                    ro.r(r_cmd)
                except Exception as r_exec_error:
                    print(f"Error executing R command: {r_exec_error}")
                    return None

                print("Reading results...")

                pseudotimes_file = os.path.join(temp_dir, "pseudotimes.csv")
                lineages_file = os.path.join(temp_dir, "lineages.csv")

                if os.path.exists(pseudotimes_file):
                    try:
                        pseudotimes_df = pd.read_csv(pseudotimes_file)
                        # Set the CellID column as index for pseudotimes to match original CSV behavior
                        if 'CellID' in pseudotimes_df.columns:
                            pseudotimes_df = pseudotimes_df.set_index('CellID')
                        elif len(pseudotimes_df.columns) > 0 and pseudotimes_df.columns[0] not in ['X1', 'Lineage1']:
                            pseudotimes_df = pseudotimes_df.set_index(pseudotimes_df.columns[0])
                        
                        lineages_df = pd.read_csv(lineages_file)
                        # Set first column as index for lineages to match original CSV behavior  
                        if len(lineages_df.columns) > 0 and 'Lineage' in lineages_df.columns:
                            lineages_df = lineages_df.set_index(lineages_df.columns[0])

                        # Check if results are empty (indicating R error)
                        if pseudotimes_df.empty or lineages_df.empty:
                            print("R analysis failed - empty results returned")
                            return None

                        # Add to adata
                        for i, col in enumerate(pseudotimes_df.columns):
                            adata.uns[f"slingshot_pseudotime_{embedding_key}_{col}"] = pseudotimes_df.iloc[:, i].values

                        # Store lineage information as metadata instead of obs
                        lineage_paths = lineages_df.groupby("Lineage")["Cluster"].apply(list).to_dict()
                        adata.uns[f"slingshot_lineages_{embedding_key}"] = lineage_paths

                        return adata
                    except Exception as read_error:
                        print(f"Error reading result files: {read_error}")
                        return None
                else:
                    print("Could not find result files")
                    return None

    except ImportError:
        print("Error: Please install rpy2 package")
        print("Run: pip install rpy2")
        print("And install Slingshot in R: BiocManager::install('slingshot')")
        return None
    except Exception as e:
        print(f"Error running Slingshot with RPy2: {e}")
        return None


def run_slingshot_by_subprocess(
    adata,
    cluster_key="leiden",
    embedding_key="X_umap",
    start_cluster=None,
    end_clusters=None,
):
    """
    Run Slingshot using subprocess to call R directly.
    Parameters:
    -----------
    adata : AnnData
        The annotated data matrix with Slingshot results
    cluster_key : str
        The key in adata.obs for cluster labels
    embedding_key : str
        The key in adata.obsm for reduced dimension coordinates
    start_cluster : str
        The starting cluster for trajectory analysis
    end_clusters : list of str
        The end clusters for trajectory analysis
        
    Returns:
    --------
    AnnData : The annotated data matrix with Slingshot results
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            print("Creating temporary files for subprocess R call...")

            # Export input data as CSV to avoid Arrow/Parquet runtime conflicts.
            if sparse.issparse(adata.X):
                expr_df = pd.DataFrame(adata.X.toarray())
            else:
                expr_df = pd.DataFrame(adata.X)

            umap_df = pd.DataFrame(
                adata.obsm[embedding_key], columns=["UMAP1", "UMAP2"]
            )
            clusters_df = pd.DataFrame({"clusters": adata.obs[cluster_key].astype(str)})

            expr_file = os.path.join(temp_dir, "expr.csv")
            umap_file = os.path.join(temp_dir, "umap.csv")
            clusters_file = os.path.join(temp_dir, "clusters.csv")

            expr_df.to_csv(expr_file, index=False)
            umap_df.to_csv(umap_file, index=False)
            clusters_df.to_csv(clusters_file, index=False)

            # Create R script
            r_script = f"""
                # Install and load required packages
                if (!requireNamespace("BiocManager", quietly = TRUE))
                    install.packages("BiocManager")

                required_packages <- c("slingshot", "SingleCellExperiment")
                for (pkg in required_packages) {{
                    if (!requireNamespace(pkg, quietly = TRUE)) {{
                        BiocManager::install(pkg)
                    }}
                }}

                library(slingshot)
                library(SingleCellExperiment)

                # Load data
                expr_matrix <- as.matrix(read.csv("{expr_file}", check.names = FALSE))
                umap_coords <- as.matrix(read.csv("{umap_file}", check.names = FALSE))
                clusters <- read.csv("{clusters_file}", check.names = FALSE)$clusters

                # Transpose gene expression matrix (gene x cell)
                expr_matrix <- t(expr_matrix)

                # Create SingleCellExperiment object
                sce <- SingleCellExperiment(
                    assays = list(counts = expr_matrix)
                )

                # Add UMAP and cluster info
                reducedDims(sce) <- list(UMAP = umap_coords)
                colData(sce)$clusters <- clusters
            """

            if start_cluster is not None:
                r_script += f'''
                    start_clus <- "{start_cluster}"
                    sce <- slingshot(sce, clusterLabels = "clusters", omega = TRUE, reducedDim = "UMAP", start.clus = start_clus)
                '''
            else:
                r_script += '''
                    sce <- slingshot(sce, clusterLabels = "clusters", reducedDim = "UMAP")
                '''

            r_script += f'''
                    # Get results
                    pseudotimes <- slingPseudotime(sce)
                    lineages <- slingLineages(sce)

                    # Save results
                    pseudotimes_df <- as.data.frame(pseudotimes)
                    pseudotimes_df <- cbind(CellID = rownames(pseudotimes_df), pseudotimes_df)
                    write.csv(pseudotimes_df, "{temp_dir}/pseudotimes.csv", row.names = FALSE)

                    lineages_df <- data.frame(
                        Lineage = rep(names(lineages), lengths(lineages)),
                        Cluster = unlist(lineages)
                    )
                    write.csv(lineages_df, "{temp_dir}/lineages.csv", row.names = FALSE)

                    n_lineages <- ncol(pseudotimes)
                    cat("Found", n_lineages, "trajectories\\n")
                '''

            # Write R script to file
            r_script_file = os.path.join(temp_dir, "slingshot_script.R")
            with open(r_script_file, "w") as f:
                f.write(r_script)

            print("Executing R script via subprocess...")

            try:
                result = subprocess.run(
                    ["Rscript", r_script_file],
                    capture_output=True,
                    text=True,
                    timeout=300,
                )

                if result.returncode != 0:
                    print(f"R script failed with return code {result.returncode}")
                    print(f"STDOUT: {result.stdout}")
                    print(f"STDERR: {result.stderr}")
                    return None

                print(f"R script output: {result.stdout}")

            except subprocess.TimeoutExpired:
                print("R script timed out after 5 minutes")
                return None
            except FileNotFoundError:
                print("Rscript not found. Please ensure R is installed and Rscript is in PATH")
                return None

            # Read results
            pseudotimes_file = os.path.join(temp_dir, "pseudotimes.csv")
            lineages_file = os.path.join(temp_dir, "lineages.csv")

            if os.path.exists(pseudotimes_file):
                try:
                    pseudotimes_df = pd.read_csv(pseudotimes_file)
                    if "CellID" in pseudotimes_df.columns:
                        pseudotimes_df = pseudotimes_df.set_index("CellID")

                    lineages_df = pd.read_csv(lineages_file)

                    if pseudotimes_df.empty or lineages_df.empty:
                        print("R analysis failed - empty results returned")
                        return None

                    for i, col in enumerate(pseudotimes_df.columns):
                        adata.uns[f"slingshot_pseudotime_{embedding_key}_{col}"] = pseudotimes_df.iloc[:, i].values

                    lineage_paths = lineages_df.groupby("Lineage")["Cluster"].apply(list).to_dict()
                    adata.uns[f"slingshot_lineages_{embedding_key}"] = lineage_paths

                    print(
                        f"Slingshot analysis completed via subprocess! Found {len(pseudotimes_df.columns)} trajectories"
                    )
                    return adata
                except Exception as read_error:
                    print(f"Error reading result files: {read_error}")
                    return None
            else:
                print("Could not find result files")
                return None

    except Exception as e:
        print(f"Error running Slingshot with subprocess: {e}")
        return None


def correct_pseudotime_order(trajectory_path, cluster_statistics, method='weighted_interpolation'):
    """
    Correct pseudotime values to ensure monotonic progression along trajectory path.
    
    Parameters:
    -----------
    trajectory_path : list
        Fixed order of clusters in the trajectory (DO NOT CHANGE)
    cluster_statistics : dict
        Dictionary containing 'mean', 'std', 'min', 'max', 'count' for each cluster
    method : str
        Method to use for correction
    
    Returns:
    --------
    dict : containing corrected pseudotime values and metrics
    """
    
    # Extract cluster data
    cluster_data = []
    for cluster in trajectory_path:
        cluster_str = str(cluster)
        if cluster_str in cluster_statistics['mean']:
            cluster_data.append({
                'cluster': cluster,
                'original_mean': cluster_statistics['mean'][cluster_str],
                'std': cluster_statistics['std'][cluster_str],
                'min': cluster_statistics['min'][cluster_str],
                'max': cluster_statistics['max'][cluster_str],
                'count': cluster_statistics['count'][cluster_str]
            })
    
    if len(cluster_data) < 2:
        original_times = [cd['original_mean'] for cd in cluster_data]
        return {
            'corrected_pseudotime': original_times,
            'original_pseudotime': original_times,
            'trajectory_path': trajectory_path,
            'method_used': method,
            'corrections_made': 0,
            'total_deviation': 0.0,
            'is_monotonic': True,
            'notes': 'Single cluster or no data - no correction needed'
        }
    
    original_pseudotime = [cd['original_mean'] for cd in cluster_data]
    
    if method == 'weighted_interpolation':
        corrected_pseudotime = weighted_interpolation_method(cluster_data)
    elif method == 'confidence_aware':
        corrected_pseudotime = confidence_aware_method(cluster_data)
    else:
        raise ValueError(f"Unknown method: {method}")
    
    # Calculate metrics
    corrections_made = sum(1 for orig, corr in zip(original_pseudotime, corrected_pseudotime) if abs(orig - corr) > 0.001)
    
    total_deviation = sum(abs(orig - corr) for orig, corr in zip(original_pseudotime, corrected_pseudotime))
    
    is_monotonic = all(corrected_pseudotime[i] <= corrected_pseudotime[i+1] for i in range(len(corrected_pseudotime)-1))
    
    return {
        'corrected_pseudotime': corrected_pseudotime,
        'original_pseudotime': original_pseudotime,
        'trajectory_path': trajectory_path,
        'method_used': method,
        'corrections_made': corrections_made,
        'total_deviation': total_deviation,
        'is_monotonic': is_monotonic,
        'cluster_data': cluster_data,
        'notes': f'Successfully corrected {corrections_made} time points with total deviation {total_deviation:.3f}'
    }


def weighted_interpolation_method(cluster_data):
    """Weighted interpolation with confidence interval awareness."""
    n = len(cluster_data)
    original_means = [cd['original_mean'] for cd in cluster_data]
    
    # Calculate weights and confidence intervals
    weights = []
    ci_bounds = []
    
    for cd in cluster_data:
        # Weight by sample size and stability
        count_weight = np.sqrt(cd['count'])
        cv = cd['std'] / abs(cd['original_mean']) if cd['original_mean'] != 0 else 1
        stability_weight = 1 / (1 + cv)
        weights.append(count_weight * stability_weight)
        
        # Confidence interval
        ci_half = 1.96 * cd['std'] / np.sqrt(cd['count'])
        ci_bounds.append((cd['original_mean'] - ci_half, cd['original_mean'] + ci_half))
    
    # Normalize weights
    weights = np.array(weights)
    weights = weights / weights.sum()
    
    # Initialize with original means
    corrected_times = np.array(original_means, dtype=float)
    
    # Iterative correction to ensure monotonicity while minimizing weighted deviation
    for iteration in range(10):  # Max iterations
        changed = False
        
        # Forward pass
        for i in range(1, n):
            if corrected_times[i] <= corrected_times[i-1]:
                # Need to correct this position
                min_required = corrected_times[i-1] + 0.01  # Small increment
                
                # Try to stay within confidence interval
                ci_lower, ci_upper = ci_bounds[i]
                
                if ci_upper >= min_required:
                    # Can maintain some connection to original data
                    new_time = max(min_required, ci_lower)
                    new_time = min(new_time, ci_upper)
                else:
                    # Must go outside CI - use minimal increase
                    new_time = min_required
                
                if abs(new_time - corrected_times[i]) > 0.001:
                    corrected_times[i] = new_time
                    changed = True
        
        # Backward adjustment pass
        for i in range(n-2, -1, -1):
            if i < n-1:
                max_allowed = corrected_times[i+1] - 0.01
                ci_lower, ci_upper = ci_bounds[i]
                
                # Try to get closer to original while respecting monotonicity
                target = original_means[i]
                new_time = min(max(target, ci_lower), min(max_allowed, ci_upper))
                
                if new_time != corrected_times[i] and abs(new_time - corrected_times[i]) > 0.001:
                    corrected_times[i] = new_time
                    changed = True
        
        if not changed:
            break
    
    return corrected_times.tolist()


def confidence_aware_method(cluster_data):
    """Simple confidence interval aware correction."""
    n = len(cluster_data)
    corrected_times = []
    
    for i, cd in enumerate(cluster_data):
        original_mean = cd['original_mean']
        ci_half = 1.96 * cd['std'] / np.sqrt(cd['count'])
        
        if i == 0:
            corrected_times.append(original_mean)
        else:
            prev_time = corrected_times[i-1]
            min_required = prev_time + 0.01
            
            # Try to stay close to original mean while ensuring monotonicity
            if original_mean >= min_required:
                corrected_times.append(original_mean)
            elif original_mean + ci_half >= min_required:
                # Can stay within upper CI bound
                corrected_times.append(min_required)
            else:
                # Must go outside CI
                corrected_times.append(min_required)
    
    return corrected_times


def analyze_gene_expression_along_trajectories(
    adata, gene_names, trajectory_analysis=None, embedding_key="X_umap"
):
    """
    Analyze the expression of specified genes along trajectories based on pseudotime.

    Parameters:
    -----------
    adata : AnnData
        The annotated data matrix with gene expression and pseudotime data
    gene_names : str or list
        Gene name(s) to analyze
    trajectory_analysis : dict, optional
        Dictionary containing trajectory analysis results
    embedding_key : str
        The embedding key used for the trajectory analysis

    Returns:
    --------
    dict
        Dictionary containing gene expression analysis results for each trajectory
    """
    # Input gene_names can be a single gene or a list of genes
    if isinstance(gene_names, str):
        gene_names = [gene_names]

    # Use provided trajectory analysis or look for existing ones
    if trajectory_analysis is None:
        print("No trajectory analysis provided. Please run trajectory analysis first.")
        return {}

    print(f"Gene Analysis: {', '.join(gene_names)}")
    print(f"Number of Trajectories: {len(trajectory_analysis)}")
    print("=" * 60)

    # Check for available genes
    available_genes = []
    missing_genes = []

    for gene in gene_names:
        if gene in adata.var_names:
            available_genes.append(gene)
        else:
            missing_genes.append(gene)

    if missing_genes:
        print(f"Genes not found: {', '.join(missing_genes)}")

        # Try to find similar genes in highly variable genes
        for missing_gene in missing_genes:
            # Search in highly variable genes
            if hasattr(adata.var, "highly_variable"):
                hvg_genes = adata.var_names[adata.var.highly_variable]
                matches = [g for g in hvg_genes if missing_gene.lower() in g.lower()]
                if matches:
                    print(f"'{missing_gene}' possible matches: {matches[:5]}")

    if not available_genes:
        print("No available genes for analysis")
        return {}

    print(f"Available genes for analysis: {', '.join(available_genes)}")

    # Get all pseudotime columns with embedding key
    pseudotime_cols = [
        col for col in adata.obs.columns if col.startswith(f"slingshot_pseudotime_{embedding_key}_")
    ]

    # Create analysis for each gene
    gene_results = {}

    for gene in available_genes:
        print(f"Analyzing: {gene}")
        print("-" * 50)

        # Get gene expression data
        gene_idx = adata.var_names.get_loc(gene)
        if hasattr(adata.X, "toarray"):
            gene_expression = adata.X[:, gene_idx].toarray().flatten()
        else:
            gene_expression = adata.X[:, gene_idx]

        # Analyze each trajectory
        trajectory_data = {}

        for traj_key, traj_info in trajectory_analysis.items():
            if "clusters_involved" not in traj_info:
                continue

            traj_num = traj_key.split("_")[-1] if "_" in traj_key else traj_key

            # Find the corresponding pseudotime column with embedding key
            pt_col = None
            for col in pseudotime_cols:
                if col.endswith(f"_{traj_num}"):
                    pt_col = col
                    break

            if pt_col is None:
                print(f"No pseudotime data found for trajectory {traj_num}")
                continue

            # Get valid cells for this trajectory
            valid_mask = ~np.isnan(adata.obs[pt_col])
            if valid_mask.sum() == 0:
                continue

            # Extract pseudotime and gene expression for valid cells
            pseudotime = adata.obs[pt_col][valid_mask].values
            expression = gene_expression[valid_mask]

            # Calculate Spearman correlation
            correlation, p_value = stats.spearmanr(pseudotime, expression)

            trajectory_data[traj_key] = {
                "pseudotime": pseudotime,
                "expression": expression,
                "correlation": correlation,
                "p_value": p_value,
                "n_cells": len(pseudotime),
                "traj_name": f"Trajectory{traj_num}",
            }

            print(
                f"{trajectory_data[traj_key]['traj_name']}: "
                f"Correlation={correlation:.3f}, p={p_value:.3e}, Cell Count={len(pseudotime)}"
            )

        gene_results[gene] = trajectory_data

    return gene_results


def direct_slingshot_analysis(
    adata,
    start_cluster=None,
    cluster_key="leiden",
    embedding_key="X_umap",
    end_clusters=None,
    **kwargs
):
    """
    Direct Slingshot Analysis with an optional start cluster.

    Parameters:
    -----------
    adata : AnnData
        Single-cell data
    start_cluster : str or int, optional
        The cluster ID to use as the starting point for trajectory analysis.
        If None, Slingshot will automatically determine the starting point.
    cluster_key : str
        Clustering information key in adata.obs
    embedding_key : str
        Embedding coordinates key in adata.obsm
    end_clusters : list, optional
        List of cluster IDs to use as end points. If None, Slingshot will
        automatically determine end points.
    **kwargs : dict
        Additional arguments passed to run_slingshot
        
    Returns:
    --------
    dict : containing analysis results and updated adata
    """
    
    print("=====Direct Slingshot Analysis=====")
    print("=" * 50)
    if start_cluster is not None:
        print(f"Start cluster: {start_cluster}")
    else:
        print("Start cluster: Auto-determined by Slingshot")
    print(f"Cluster key: {cluster_key}")
    print(f"Embedding key: {embedding_key}")

    if end_clusters:
        print(f"End clusters: {end_clusters}")
    else:
        print("End clusters: Auto-determined by Slingshot")
    print("=" * 50)
    
    # Validate start_cluster exists in the data (only if provided)
    if start_cluster is not None:
        unique_clusters = adata.obs[cluster_key].unique()
        unique_clusters = [str(c) for c in unique_clusters if pd.notna(c)]
        
        if str(start_cluster) not in unique_clusters:
            print(f"Error: Start cluster '{start_cluster}' not found in data.")
            print(f"Available clusters: {unique_clusters}")
            return None
        
        # Check cluster size
        cluster_mask = adata.obs[cluster_key] == start_cluster
        cluster_size = cluster_mask.sum()
        print(f"Start cluster size: {cluster_size} cells")
        
        if cluster_size < 5:
            print(f"Warning: Start cluster has only {cluster_size} cells, which may be too small for reliable trajectory analysis.")
    
    # Validate embedding exists
    if embedding_key not in adata.obsm:
        print(f"Error: Embedding '{embedding_key}' not found in adata.obsm")
        print(f"Available embeddings: {list(adata.obsm.keys())}")
        return None
    
    # Run Slingshot analysis directly
    print("Running Slingshot analysis...")
    try:
        # Prepare arguments for run_slingshot
        slingshot_kwargs = {
            'adata': adata.copy(),
            'cluster_key': cluster_key,
            'embedding_key': embedding_key,
            'end_clusters': end_clusters,
            **kwargs
        }
        
        # Only add start_cluster if it's provided
        if start_cluster is not None:
            slingshot_kwargs['start_cluster'] = str(start_cluster)
        
        result_adata = run_slingshot(**slingshot_kwargs)
        
        print(result_adata)

        if result_adata is None:
            print("Slingshot analysis failed.")
            return None
        
        # Get pseudotime columns from adata.uns (where slingshot results are stored)
        pt_cols = [key for key in result_adata.uns.keys() if key.startswith(f"slingshot_pseudotime_{embedding_key}")]
        
        print(f"Analysis completed successfully!")
        
        # Basic trajectory information
        trajectory_info = {}
        for i, pt_col in enumerate(pt_cols):
            traj_name = f"Trajectory_{i+1}"
            valid_mask = ~np.isnan(result_adata.uns[pt_col])
            valid_cells = valid_mask.sum()
            
            trajectory_info[traj_name] = {
                "pseudotime_column": pt_col,
                "valid_cells": int(valid_cells),
                "total_cells": int(len(result_adata)),
                "coverage": float(valid_cells / len(result_adata))
            }
            
            print(f"{traj_name}: {valid_cells} cells ({trajectory_info[traj_name]['coverage']:.1%} coverage)")
        
        # Analyze cluster transitions using lineages data
        print("\nAnalyzing cluster transitions...")
        cluster_transitions = {}
        
        # Get lineages data from adata.uns
        lineages_key = f"slingshot_lineages_{embedding_key}"
        if lineages_key in result_adata.uns:
            lineage_paths = result_adata.uns[lineages_key]
            print(f"Found lineages data: {lineage_paths}")
            
            # Match trajectories with lineage paths
            for i, (traj_name, traj_info) in enumerate(trajectory_info.items()):
                pt_col = traj_info["pseudotime_column"]
                valid_mask = ~np.isnan(result_adata.uns[pt_col])
                
                if valid_mask.sum() == 0:
                    continue
                
                # Find corresponding lineage path
                lineage_key = f"Lineage{i+1}"  # Assuming lineages are numbered starting from 1
                
                # Check if lineage key exists before accessing it
                if lineage_key not in lineage_paths:
                    print(f"Warning: {lineage_key} not found in lineages data. Available lineages: {list(lineage_paths.keys())}")
                    print(f"Skipping {traj_name} - no corresponding lineage path found")
                    continue
                    
                cluster_path = lineage_paths[lineage_key]
                
                # Calculate cluster statistics for validation
                # Create a temporary dataframe with pseudotime and cluster info
                traj_data = pd.DataFrame({
                    pt_col: result_adata.uns[pt_col][valid_mask],
                    cluster_key: result_adata.obs[cluster_key][valid_mask]
                })
                traj_data = traj_data.sort_values(pt_col)
                
                cluster_stats = traj_data.groupby(cluster_key)[pt_col].agg([
                    "mean", "std", "min", "max", "count"
                ]).sort_values("mean")
                
                cluster_transitions[traj_name] = {
                    "ordered_clusters": cluster_path,
                    "cluster_statistics": cluster_stats.to_dict() if not cluster_stats.empty else {},
                    "transition_path": " → ".join([str(c) for c in cluster_path])
                }
                
                print(f"{traj_name}: {cluster_transitions[traj_name]['transition_path']}")
        else:
            print(f"Warning: No lineages data found in adata.uns['{lineages_key}']")
            # Fallback to original method if lineages data is not available
            for traj_name, traj_info in trajectory_info.items():
                pt_col = traj_info["pseudotime_column"]
                valid_mask = ~np.isnan(result_adata.uns[pt_col])
                
                if valid_mask.sum() == 0:
                    continue
                
                # Get trajectory data
                # Create a temporary dataframe with pseudotime and cluster info
                traj_data = pd.DataFrame({
                    pt_col: result_adata.uns[pt_col][valid_mask],
                    cluster_key: result_adata.obs[cluster_key][valid_mask]
                })
                traj_data = traj_data.sort_values(pt_col)
                
                # Calculate cluster statistics along trajectory
                cluster_stats = traj_data.groupby(cluster_key)[pt_col].agg([
                    "mean", "std", "min", "max", "count"
                ]).sort_values("mean")
                
                # Filter out clusters with NaN mean pseudotime
                valid_clusters = cluster_stats[~np.isnan(cluster_stats["mean"])]
                
                if len(valid_clusters) > 0:
                    cluster_transitions[traj_name] = {
                        "ordered_clusters": valid_clusters.index.tolist(),
                        "cluster_statistics": valid_clusters.to_dict(),
                        "transition_path": " → ".join([str(c) for c in valid_clusters.index])
                    }
                    
                    print(f"{traj_name}: {cluster_transitions[traj_name]['transition_path']}")
        
        # Extract path and pseudotime information for simplified return
        result_array = []
        
        for traj_name, traj_data in cluster_transitions.items():
            if "ordered_clusters" in traj_data and "cluster_statistics" in traj_data:
                path = [int(cluster) for cluster in traj_data["ordered_clusters"]]
                cluster_stats = traj_data["cluster_statistics"]
                
                # Extract mean pseudotime for each cluster in the path
                pseudotime = []
                if cluster_stats and "mean" in cluster_stats:
                    mean_dict = cluster_stats["mean"]
                    for cluster in path:
                        # Convert cluster to string for lookup since mean_dict keys are strings
                        cluster_str = str(cluster)
                        if cluster_str in mean_dict:
                            pseudotime.append(float(mean_dict[cluster_str]))
                        else:
                            pseudotime.append(None)
                else:
                    # If no mean statistics available, fill with None
                    pseudotime = [None] * len(path)
                
                # Apply pseudotime correction using 'Confidence Aware' method
                if cluster_stats and len(path) > 1:
                    try:
                        correction_result = correct_pseudotime_order(
                            trajectory_path=path,
                            cluster_statistics=cluster_stats,
                            method='confidence_aware'
                        )
                        corrected_pseudotime = [float(pt) for pt in correction_result['corrected_pseudotime']]
                        
                        print(f"{traj_name}: Applied confidence aware correction")
                        print(f"  Original pseudotime: {[f'{pt:.3f}' if pt is not None else 'None' for pt in pseudotime]}")
                        print(f"  Corrected pseudotime: {[f'{pt:.3f}' for pt in corrected_pseudotime]}")
                        print(f"  Corrections made: {correction_result['corrections_made']}")
                        print(f"  Total deviation: {correction_result['total_deviation']:.3f}")
                        print(f"  Is monotonic: {correction_result['is_monotonic']}")
                        
                        # Get coverage info for this trajectory
                        traj_info = trajectory_info.get(traj_name, {})
                        
                        result_array.append({
                            "path": path,
                            "pseudotime": corrected_pseudotime,
                            "original_pseudotime": [float(pt) if pt is not None else None for pt in pseudotime],
                            "correction_info": correction_result,
                            "coverage": traj_info.get("coverage", 0),
                            "valid_cells": traj_info.get("valid_cells", 0),
                            "total_cells": traj_info.get("total_cells", 0)
                        })
                    except Exception as e:
                        print(f"Warning: Pseudotime correction failed for {traj_name}: {e}")
                        # Get coverage info for this trajectory
                        traj_info = trajectory_info.get(traj_name, {})
                        
                        result_array.append({
                            "path": path,
                            "pseudotime": [float(pt) if pt is not None else None for pt in pseudotime],
                            "original_pseudotime": [float(pt) if pt is not None else None for pt in pseudotime],
                            "correction_info": {"error": str(e)},
                            "coverage": traj_info.get("coverage", 0),
                            "valid_cells": traj_info.get("valid_cells", 0),
                            "total_cells": traj_info.get("total_cells", 0)
                        })
                else:
                    # Get coverage info for this trajectory
                    traj_info = trajectory_info.get(traj_name, {})
                    
                    result_array.append({
                        "path": path,
                        "pseudotime": [float(pt) if pt is not None else None for pt in pseudotime],
                        "original_pseudotime": [float(pt) if pt is not None else None for pt in pseudotime],
                        "correction_info": {"note": "No correction applied - insufficient data or single cluster"},
                        "coverage": traj_info.get("coverage", 0),
                        "valid_cells": traj_info.get("valid_cells", 0),
                        "total_cells": traj_info.get("total_cells", 0)
                    })
        
        return result_adata, result_array
        
    except Exception as e:
        print(f"Error during Slingshot analysis: {e}")
        return None