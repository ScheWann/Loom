library(SPATA2)
library(tidyverse)

# start timer
start_time <- Sys.time()

#####  Load
object <-
  initiateSpataObjectVisiumHD(
    sample_name = "skin_TXK6Z4X_A1",
    directory_visium = "./skin_TXK6Z4X_A1",
    square_res = "16um",
  )

#####  Image processing
object <- identifyPixelContent(object, frgmt_threshold = c(0.01,0.05))
object <- identifyTissueOutline(object, method = "image")

#####  Clean
# removes stress genes
object <- removeGenesStress(object)

# removes genes that were not detected in any of the observations
object <- removeGenesZeroCounts(object)

# check for and remove observations with zero counts
object <- removeObsZeroCounts(object)

##### Matrix processing
# create log normalized matrix
object <- normalizeCounts(object, method = "LogNormalize")

##### Variable genes
# identifies molecules of high variability in the default assay (= gene)
object <- identifyVariableMolecules(object, method = "vst", n_mol = 2500)

##### Save
rds_path <- "./skin_TXK6Z4X_A1_16um_object_processed.rds"
saveRDS(object, file = rds_path)

# stop timer and report elapsed time
end_time <- Sys.time()
elapsed <- end_time - start_time
message("Saved object to ", normalizePath(rds_path))
message("Elapsed time: ", round(as.numeric(elapsed, units = "secs"), 2), " seconds")
