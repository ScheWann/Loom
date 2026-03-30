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

# Install R packages from CRAN, Bioconductor, and GitHub
RUN R -e " install.packages('arrow', repos='https://cran.rstudio.com/'); \
    install.packages('remotes', repos='https://cran.rstudio.com/'); \
    install.packages(c('BiocManager'), repos='http://cran.rstudio.com/'); \
    BiocManager::install(c('BiocGenerics', 'DelayedArray', 'DelayedMatrixStats', 'limma', 'S4Vectors', 'SingleCellExperiment', 'SummarizedExperiment', 'batchelor', 'slingshot', 'EBImage')); \
    install.packages('https://cran.r-project.org/src/contrib/Archive/grr/grr_0.9.5.tar.gz', repos=NULL, type='source'); \
    remotes::install_github('cvarrichio/Matrix.utils'); \
    install.packages(c('devtools'), repos='http://cran.rstudio.com/'); \
    install.packages(c('tidyverse'), repos='https://cran.rstudio.com/'); \
    remotes::install_github('haleyjeppson/ggmosaic'); \
    remotes::install_github('hrbrmstr/ggalt'); \
    remotes::install_github('kueckelj/confuns'); \
    devtools::install_github('theMILOlab/SPATAData'); \
    options(timeout=400); \
    devtools::install_github('theMILOlab/SPATA2'); \
    devtools::install_github('xzhoulab/SPARK')"

WORKDIR /app/Backend

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5003

CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "1", "--threads", "4", "--timeout", "300", "server:app"]
