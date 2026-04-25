FROM python:3.11

# Install R (required by rpy2) and system-level libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    r-base \
    r-base-dev \
    libuv1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    pandoc \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libgdal-dev \
    libproj-dev \
    libgeos-dev \
    libhdf5-dev \
    libudunits2-dev \
    gdal-bin \
    libgdal-dev \
    libfontconfig1-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff5-dev \
    libfreetype6-dev \
    libgit2-dev \
    && rm -rf /var/lib/apt/lists/*

# Install basic R package managers
RUN R -e "install.packages('remotes', repos='https://cran.rstudio.com/')"
RUN R -e "install.packages('devtools', repos='https://cran.rstudio.com/')"
RUN R -e "install.packages('BiocManager', repos='https://cran.rstudio.com/')"

# CRAN packages
RUN R -e "install.packages('arrow', repos='https://cran.rstudio.com/')"
RUN R -e "install.packages('tidyverse', repos='https://cran.rstudio.com/')"

# Bioconductor packages
RUN R -e "BiocManager::install(c('BiocGenerics', 'DelayedArray', 'DelayedMatrixStats'), ask=FALSE, update=FALSE)"
RUN R -e "BiocManager::install(c('limma', 'S4Vectors'), ask=FALSE, update=FALSE)"
RUN R -e "BiocManager::install(c('SingleCellExperiment', 'SummarizedExperiment'), ask=FALSE, update=FALSE)"
RUN R -e "BiocManager::install(c('batchelor', 'slingshot', 'EBImage'), ask=FALSE, update=FALSE)"

# Archived CRAN package
RUN R -e "install.packages('https://cran.r-project.org/src/contrib/Archive/grr/grr_0.9.5.tar.gz', repos=NULL, type='source')"

# GitHub packages
RUN R -e "remotes::install_github('cvarrichio/Matrix.utils')"
RUN R -e "remotes::install_github('haleyjeppson/ggmosaic')"
RUN R -e "remotes::install_github('hrbrmstr/ggalt')"
RUN R -e "remotes::install_github('kueckelj/confuns')"
RUN R -e "devtools::install_github('theMILOlab/SPATAData')"
RUN R -e "options(timeout=400); devtools::install_github('theMILOlab/SPATA2')"
RUN R -e "devtools::install_github('xzhoulab/SPARK')"

WORKDIR /app/Backend

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5003

CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "1", "--threads", "4", "--timeout", "600", "server:app"]
