import os
import pandas as pd
import subprocess
import tempfile
import time


def run_spata2_analysis(base_sample_id, barcodes_data, start_16um_lowres, end_16um_lowres, arrow_width_16um_pixels, trajectory_name):
    """
    Run SPATA2 analysis using R subprocess
    
    Parameters:
    - base_sample_id: Base sample ID (e.g., "skin_TXK6Z4X_A1")
    - barcodes_data: List of barcode dictionaries with 'barcode', 'x_fullres', 'y_fullres'
    - start_16um_lowres: [x, y] start coordinates in 16um lowres space
    - end_16um_lowres: [x, y] end coordinates in 16um lowres space
    - arrow_width_16um_pixels: Arrow width in 16um pixels
    - trajectory_name: User-defined name for the trajectory
    
    Returns:
    - Dictionary containing trajectory data, significant genes, and trajectory ID
    """
    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            # Use the provided trajectory name as the trajectory ID
            trajectory_id = trajectory_name
            
            # Determine which RDS file to use based on sample ID
            example_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Example_Data")
            if "skin_TXK6Z4X_A1" in base_sample_id:
                rds_file = os.path.join(example_data_dir, "skin_TXK6Z4X_A1_16um_object_processed.rds")
            elif "skin_TXK6Z4X_D1" in base_sample_id:
                rds_file = os.path.join(example_data_dir, "skin_TXK6Z4X_D1_16um_object_processed.rds")
            else:
                raise ValueError(f"No matching RDS file found for sample {base_sample_id}")
            
            if not os.path.exists(rds_file):
                raise FileNotFoundError(f"RDS file not found: {rds_file}")
            
            # Create CSV file with barcode data
            csv_file = os.path.join(temp_dir, "roi_barcodes.csv")
            if len(barcodes_data) > 0:
                df = pd.DataFrame(barcodes_data)
                df.to_csv(csv_file, index=False)
            else:
                # Create empty CSV with required columns
                pd.DataFrame(columns=["barcode", "x_fullres", "y_fullres"]).to_csv(csv_file, index=False)
            
            # Create R script based on existing_16um_barcodes.R
            r_script = f'''
                library(SPATA2)
                library(tidyverse)
                library(SPARK)

                # Load the object
                object <- readRDS("{rds_file}")

                # Function to read barcodes from CSV (simplified version)
                read_roi_barcodes_from_csv <- function(csv_path) {{
                if (!file.exists(csv_path)) {{
                    return(character(0))
                }}
                
                df <- readr::read_csv(csv_path, show_col_types = FALSE)
                
                if (nrow(df) == 0) {{
                    return(character(0))
                }}
                
                # Standardize column names
                std_names <- names(df) %>%
                    stringr::str_trim() %>%
                    stringr::str_replace_all("\\\\s+", "_") %>%
                    tolower()
                names(df) <- std_names
                
                cand <- c("barcode","barcodes","barcode_id","spot_id","spot")
                bc_col <- cand[cand %in% names(df)][1]
                
                if(is.na(bc_col)) {{
                    return(character(0))
                }}
                
                roi_bcs <- df[[bc_col]] %>%
                    as.character() %>%
                    stringr::str_trim() %>%
                    discard(~ is.na(.x) || .x == "") %>%
                    unique()
                
                return(roi_bcs)
                }}

                # Function to subset SPATA object
                subset_spata_with_csv <- function(object, csv_path) {{
                roi_bcs <- read_roi_barcodes_from_csv(csv_path)
                
                if (length(roi_bcs) == 0) {{
                    stop("No valid barcodes found in CSV file")
                }}
                
                all_bcs <- SPATA2::getBarcodes(object)
                present <- roi_bcs[roi_bcs %in% all_bcs]
                
                if(length(present) == 0) {{
                    stop("No barcode matches in the object. Please verify that the CSV matches the current 16µm sample.")
                }}
                
                object_roi <- SPATA2::subsetSpataObject(object, barcodes = present)
                return(object_roi)
                }}

                # Main analysis
                tryCatch({{
                # Load and subset object
                object_roi <- subset_spata_with_csv(object, "{csv_file}")
                
                # Run SPARKX
                object_roi <- runSPARKX(object_roi)
                vars <- getSparkxGenes(object_roi, threshold_pval = 0.05)
                
                # Add spatial trajectory with converted coordinates
                object_roi <- addSpatialTrajectory(
                    object = object_roi,
                    id = "{trajectory_id}",
                    width = "{arrow_width_16um_pixels}px",
                    start = c(x = "{start_16um_lowres[0]}px", y = "{start_16um_lowres[1]}px"),
                    end = c(x = "{end_16um_lowres[0]}px", y = "{end_16um_lowres[1]}px"),
                    overwrite = TRUE
                )
                
                # Spatial trajectory screening
                sts1 <- spatialTrajectoryScreening(
                    object    = object_roi,
                    id        = "{trajectory_id}",
                    n_random  = 5000,
                    variables = vars
                )
                
                # Get significant results
                sign_df    <- sts1@results$significance %>% dplyr::filter(fdr < 0.05)
                non_random <- getSgsResultsVec(sts1)
                
                # Generate line plot data
                p <- plotStsLineplot(object_roi, variables = non_random, id = "{trajectory_id}")
                
                # Extract plot data
                plot_layer_data <- ggplot2::ggplot_build(p)$data[[1]]
                panel_map <- ggplot_build(p)$layout$layout
                panel_lookup <- panel_map %>% dplyr::select(PANEL, variables)
                plot_layer_data_with_var <- dplyr::left_join(plot_layer_data, panel_lookup, by = "PANEL")
                
                # Save results
                write.csv(plot_layer_data_with_var, "{temp_dir}/trajectory_results.csv", row.names = FALSE)
                
                # Save gene list
                write.csv(data.frame(gene = non_random), "{temp_dir}/significant_genes.csv", row.names = FALSE)
                
                cat("Analysis completed successfully\\n")
                
                }}, error = function(e) {{
                cat("Error in R analysis:", e$message, "\\n")
                quit(status = 1)
                }})
            '''
            
            # Write R script to file
            r_script_file = os.path.join(temp_dir, "spata2_analysis.R")
            with open(r_script_file, 'w') as f:
                f.write(r_script)
            
            print("Executing SPATA2 R script...")
            
            # Run R script
            try:
                result = subprocess.run(
                    ['Rscript', r_script_file],
                    capture_output=True,
                    text=True,
                    timeout=600  # 10 minute timeout
                )
                
                if result.returncode != 0:
                    print(f"R script failed with return code {result.returncode}")
                    print(f"STDOUT: {result.stdout}")
                    print(f"STDERR: {result.stderr}")
                    return None
                    
                print(f"R script output: {result.stdout}")
                
            except subprocess.TimeoutExpired:
                print("R script timed out after 10 minutes")
                return None
            except FileNotFoundError:
                print("Rscript not found. Please ensure R is installed and Rscript is in PATH")
                return None
            
            # Read results
            results_file = os.path.join(temp_dir, "trajectory_results.csv")
            genes_file = os.path.join(temp_dir, "significant_genes.csv")
            
            trajectory_data = None
            significant_genes = []
            
            if os.path.exists(results_file):
                try:
                    trajectory_data = pd.read_csv(results_file)
                    print(f"Successfully loaded trajectory data with {len(trajectory_data)} rows")
                except Exception as e:
                    print(f"Error reading trajectory results: {e}")
            
            if os.path.exists(genes_file):
                try:
                    genes_df = pd.read_csv(genes_file)
                    significant_genes = genes_df['gene'].tolist()
                    print(f"Successfully loaded {len(significant_genes)} significant genes")
                except Exception as e:
                    print(f"Error reading significant genes: {e}")
            
            return {
                "trajectory_data": trajectory_data.to_dict('records') if trajectory_data is not None else [],
                "significant_genes": significant_genes,
                "trajectory_id": trajectory_id
            }
            
    except Exception as e:
        print(f"Error in SPATA2 analysis: {e}")
        return None