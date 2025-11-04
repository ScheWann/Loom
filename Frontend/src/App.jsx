import { useEffect, useState, useRef } from "react";
import { Select, Spin, message, Button, Splitter, Modal, Form, Input, Upload, ConfigProvider, Empty } from "antd";
import "./App.css";
import { SampleViewer } from "./components/SampleViewer";
import { PlusOutlined, InboxOutlined, PaperClipOutlined, CloseOutlined } from "@ant-design/icons";
import "@ant-design/v5-patch-for-react-19";
import { UmapComponent } from "./components/UmapComponent";
import { TrajectoryViewer } from "./components/TrajectoryViewer";
import { PseudotimeGlyphComponent } from "./components/PseudotimeGlyphComponent";
import { COLOR_PALETTE } from "./components/Utils";

// Custom theme configuration
const customTheme = {
  token: {
    colorPrimary: "#1890ff",
    colorPrimaryHover: "#40a9ff",
    colorPrimaryActive: "#096dd9",
  },
};

function App() {
  // Sample selector state
  const [selectOptions, setSelectOptions] = useState([]); // Available sample Option(e.g. [{value: 'skin_TXK6Z4X_A1', label: 'skin_TXK6Z4X_A1'}, ...])
  const [selectedSamples, setSelectedSamples] = useState([]); // Confirmed sample to be displayed(e.g. [{id: 'sample_id', name: 'sample_id'}, ...])
  const [tempSamples, setTempSamples] = useState([]); // The sample identified in the selector
  const [sampleDataLoading, setSampleDataLoading] = useState(false); // Sample Data Loading

  // Cell coordinates data state
  const [coordinatesData, setCoordinatesData] = useState({}); // each sample's cell type directory(e.g. {"skin_TXK6Z4X_A1": [{"cell_type": "cd19+cd20+ b","cell_x": 3526, "cell_y": 3780, "id": "ID_1}, ...}])'

  // Cell types data state
  const [cellTypesData, setCellTypesData] = useState({}); // Per-sample cell types with counts {sampleId: [{name, count}, ...]}
  const [selectedCellTypes, setSelectedCellTypes] = useState({}); // Per-sample selected cell types {sampleId: [cellTypeNames]}
  const [cellTypeColors, setCellTypeColors] = useState({}); // Color mapping for cell types {cellTypeName: color}

  // Data upload form state
  const [uploadFormVisible, setUploadFormVisible] = useState(false); // Upload form visibility

  // UMAP data state
  const [umapDataSets, setUmapDataSets] = useState([]); // Array of {id, title, data, loading}
  const [umapLoading, setUmapLoading] = useState(false);
  const [hoveredCluster, setHoveredCluster] = useState(null); // {cluster: string, umapId: string, cellIds: array}

  // Pseudotime data state
  const [pseudotimeDataSets, setPseudotimeDataSets] = useState({}); // Object keyed by adata_umap_title
  const [pseudotimeLoadingStates, setPseudotimeLoadingStates] = useState({}); // Object keyed by adata_umap_title

  // Cluster color mapping state
  const [clusterColorMappings, setClusterColorMappings] = useState({}); // Object keyed by "${sampleId}_${adata_umap_title}"

  // Cell Name state
  const [cellName, setCellName] = useState(null);

  // Trajectory hover state
  const [hoveredTrajectory, setHoveredTrajectory] = useState(null); // {path: ['Cluster 1', 'Cluster 2', ...], adata_umap_title: string, sampleId: string}

  // Kosara display toggle state
  const [kosaraDisplayEnabled, setKosaraDisplayEnabled] = useState(false);

  // Gene selection from TrajectoryViewer for Kosara display
  const [trajectoryGenes, setTrajectoryGenes] = useState([]);
  const [trajectoryGenesSample, setTrajectoryGenesSample] = useState(null);

  // Trajectory guideline state
  const [trajectoryGuideline, setTrajectoryGuideline] = useState(null);

  // Ref for TrajectoryViewer to call refresh
  const trajectoryViewerRef = useRef(null);

  useEffect(() => {
    fetchSamplesOption();
  }, []);

  // get all aviailable sample options
  const fetchSamplesOption = () => {
    fetch("/api/get_samples_option")
      .then((response) => response.json())
      .then((data) => {
        setSelectOptions(data);
      })
      .catch((error) => {
        message.error("Get samples failed");
      });
  };

  // get cell coordinates for selected samples(cell or dot)
  const fetchCoordinates = async (sampleIds) => {
    const coordinatesResponse = await fetch("/api/get_coordinates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sample_ids: sampleIds }),
    });
    const coordinatesData = await coordinatesResponse.json();
    setCoordinatesData(coordinatesData);

    // Fetch cell types data at the same time
    await fetchCellTypes(sampleIds);
  };

  // get cell types data for selected samples
  const fetchCellTypes = async (sampleIds) => {
    try {
      const cellTypesResponse = await fetch("/api/get_cell_types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_ids: sampleIds }),
      });

      if (cellTypesResponse.ok) {
        const cellTypesData = await cellTypesResponse.json();
        const newCellTypesData = {};
        const newSelectedCellTypes = {};
        const newCellTypeColors = {};

        sampleIds.forEach((sampleId) => {
          newCellTypesData[sampleId] = cellTypesData[sampleId] || [];
          newSelectedCellTypes[sampleId] = newCellTypesData[sampleId].map(({ name }) => name);
          newCellTypesData[sampleId].forEach(({ name }, index) => {
            newCellTypeColors[name] = COLOR_PALETTE[index % COLOR_PALETTE.length];
          });
        });
        setCellTypesData(newCellTypesData);
        setSelectedCellTypes(newSelectedCellTypes);
        setCellTypeColors(newCellTypeColors);
      } else {
        console.error('Failed to fetch cell types data');
        setCellTypesData({});
        setSelectedCellTypes({});
        setCellTypeColors({});
      }
    } catch (error) {
      console.error('Error fetching cell types data:', error);
      setCellTypesData({});
      setSelectedCellTypes({});
      setCellTypeColors({});
    }
  };

  // Clear AnnData cache
  const clearCache = async () => {
    try {
      await fetch("/api/clear_adata_cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      // Clear cell types data when clearing cache
      setCellTypesData({});
      setSelectedCellTypes({});
      setCellTypeColors({});
    } catch (error) {
      console.error("Error clearing cache:", error);
    }
  };

  // confirm selected samples
  const confirmSamples = async () => {
    if (tempSamples.length === 0) {
      message.warning("Please select at least one sample");
    } else {
      try {
        setSampleDataLoading(true);
        await clearCache();
        const cacheResponse = await fetch("/api/load_adata_cache", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sample_ids: tempSamples }),
        });

        if (!cacheResponse.ok) {
          const errorData = await cacheResponse.json();
          message.error(`Failed to load data cache: ${errorData.error}`);
          setSampleDataLoading(false);
          return;
        }

        await fetchCoordinates(tempSamples);
        setSelectedSamples(
          tempSamples.map((sample) => ({ id: sample, name: sample }))
        );
      } catch (error) {
        message.error(`Error confirming samples: ${error.message}`);
        setSampleDataLoading(false);
      }
    }
  };

  // Callback to be called when all images are loaded
  const onImagesLoaded = () => {
    setSampleDataLoading(false);
  };

  const handleUploadSTData = async (values) => {
    const { name, description, folder } = values;
    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", description || "");

    // Only include relevant files
    folder.forEach((fileObj) => {
      const file = fileObj.originFileObj;
      const path = fileObj.originFileObj.webkitRelativePath;
      const segments = path.split("/");
      const relativePath = segments.slice(1).join("/");

      if (
        path.endsWith(
          "binned_outputs/square_002um/filtered_feature_bc_matrix.h5"
        ) ||
        path.endsWith(
          "binned_outputs/square_008um/filtered_feature_bc_matrix.h5"
        ) ||
        path.endsWith(
          "binned_outputs/square_016um/filtered_feature_bc_matrix.h5"
        ) ||
        (segments.length > 2 && segments[1] === "spatial")
      ) {
        formData.append("files", file, relativePath);
      }
    });

    try {
      const response = await fetch("/upload_spaceranger", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        message.success("Upload successful!");
        setUploadFormVisible(false);
      } else {
        message.error("Upload failed.");
      }
    } catch (err) {
      message.error("Upload error: " + err.message);
    }
  };

  // Handler for UMAP data updates from settings popup
  const handleUmapDataUpdate = (newData, newAdataUmapTitle, newSettings, newName, umapId) => {
    setUmapDataSets(prev =>
      prev.map(dataset =>
        dataset.id === umapId
          ? {
            ...dataset,
            // Only update data if newData is provided (not null)
            ...(newData && { data: newData }),
            // Only update adata_umap_title if it's different (parameters changed)
            ...(newData && { adata_umap_title: newAdataUmapTitle }),
            title: `${newName} (${dataset.sampleId})`,
            loading: false,
            isUpdating: false
          }
          : dataset
      )
    );
  };

  // Handler to set loading state for UMAP updates
  const handleUmapLoadingStart = (umapId) => {
    setUmapDataSets(prev =>
      prev.map(dataset =>
        dataset.id === umapId
          ? { ...dataset, loading: true, isUpdating: true }
          : dataset
      )
    );
  };

  // Handler for gene selection from TrajectoryViewer
  const handleTrajectoryGeneSelection = (genes, sampleId) => {
    setTrajectoryGenes(genes);
    setTrajectoryGenesSample(sampleId);
  };

  // Handler for trajectory guideline changes
  const handleTrajectoryGuidelineChange = (guidelineData) => {
    setTrajectoryGuideline(guidelineData);
  };

  // Handler for Kosara display toggle with trajectory gene clearing
  const handleKosaraDisplayToggle = (enabled) => {
    setKosaraDisplayEnabled(enabled);
    // Clear trajectory genes when kosara display is turned off
    if (!enabled) {
      setTrajectoryGenes([]);
      setTrajectoryGenesSample(null);
    }
  };

  // Handler for trajectory analysis completion
  const handleTrajectoryAnalysisComplete = (sampleId, regionName) => {
    // Refresh trajectories in TrajectoryViewer when a new trajectory is analyzed
    if (trajectoryViewerRef.current) {
      trajectoryViewerRef.current.refreshTrajectories(sampleId, regionName);
    }
  };

  // Handler for area saved - refresh regions immediately when area is saved
  const handleAreaSaved = (sampleId, regionName) => {
    if (trajectoryViewerRef.current) {
      trajectoryViewerRef.current.refreshRegions(sampleId);
    }
  };

  return (
    <ConfigProvider theme={customTheme}>
      <div className="App">
        <div className="main">
          {/* select samples */}
          <div className="selectSamples">
            <Select
              size="small"
              mode="multiple"
              placeholder="Select samples"
              value={tempSamples}
              onChange={setTempSamples}
              options={selectOptions}
              style={{ width: "100%", marginTop: 8, marginBottom: 8 }}
              maxTagCount="responsive"
              loading={sampleDataLoading}
            />
            <Button
              size="small"
              onClick={() => setUploadFormVisible(true)}
              icon={<PlusOutlined />}
            />
            <Button size="small" onClick={confirmSamples}>
              Confirm
            </Button>
          </div>

          {/* Upload Data Form Modal */}
          <Modal
            title="Upload Data"
            open={uploadFormVisible}
            onCancel={() => setUploadFormVisible(false)}
            footer={null}
            destroyOnHidden
          >
            <Form layout="vertical" onFinish={handleUploadSTData}>
              <Form.Item
                label="Name"
                name="name"
                rules={[{ required: true, message: "Please input a name!" }]}
              >
                <Input placeholder="Custom name" />
              </Form.Item>
              <Form.Item label="Description" name="description">
                <Input.TextArea placeholder="Description (optional)" rows={2} />
              </Form.Item>
              <Form.Item
                label="Upload Folder"
                name="folder"
                valuePropName="fileList"
                getValueFromEvent={(e) =>
                  Array.isArray(e) ? e : e && e.fileList
                }
                rules={[
                  {
                    required: true,
                    message: "Please upload a spaceranger output folder!",
                  },
                ]}
              >
                <Upload.Dragger
                  directory
                  multiple
                  showUploadList={true}
                  beforeUpload={(file) => {
                    const path = file.webkitRelativePath || file.name;
                    const matrixH5Pattern =
                      /binned_outputs\/square_(002|008|016)um\/filtered_feature_bc_matrix\.h5$/;
                    const spatialPattern = /\/spatial\//;
                    if (matrixH5Pattern.test(path)) {
                      return false;
                    }
                    if (spatialPattern.test(path) && !/\/\./.test(path)) {
                      return false;
                    }
                    return Upload.LIST_IGNORE;
                  }}
                  itemRender={(originNode, file) => (
                    <div className="ant-upload-list-item-name">
                      <PaperClipOutlined style={{ marginRight: 6 }} />
                      {file.name}
                    </div>
                  )}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-hint">
                    Click or drag folder to this area to upload
                  </p>
                </Upload.Dragger>
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block>
                  Upload
                </Button>
              </Form.Item>
            </Form>
          </Modal>

          {/* all views */}
          <div className="content" style={{ position: "relative" }}>
            {selectedSamples.length > 0 || sampleDataLoading ? (
              <>
                {sampleDataLoading && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      background: "rgba(0, 0, 0, 0.2)",
                      zIndex: 1000,
                    }}
                  >
                    <Spin spinning={true} size="large" />
                  </div>
                )}
                <Splitter lazy style={{ width: "100%", height: "100%" }}>
                  <Splitter.Panel defaultSize="60%" min="50%" max="60%">
                    <SampleViewer
                      selectedSamples={selectedSamples}
                      coordinatesData={coordinatesData}
                      cellTypesData={cellTypesData}
                      setCellTypesData={setCellTypesData}
                      selectedCellTypes={selectedCellTypes}
                      setSelectedCellTypes={setSelectedCellTypes}
                      cellTypeColors={cellTypeColors}
                      setCellTypeColors={setCellTypeColors}
                      umapDataSets={umapDataSets}
                      setUmapDataSets={setUmapDataSets}
                      umapLoading={umapLoading}
                      setUmapLoading={setUmapLoading}
                      hoveredCluster={hoveredCluster}
                      onImagesLoaded={onImagesLoaded}
                      kosaraDisplayEnabled={kosaraDisplayEnabled}
                      trajectoryGenes={trajectoryGenes}
                      trajectoryGenesSample={trajectoryGenesSample}
                      trajectoryGuideline={trajectoryGuideline}
                      onTrajectoryAnalysisComplete={handleTrajectoryAnalysisComplete}
                      onAreaSaved={handleAreaSaved}
                    />
                  </Splitter.Panel>
                  <Splitter.Panel defaultSize="40%" min="40%" max="50%">
                    <Splitter lazy layout="vertical">
                      <Splitter.Panel
                        defaultSize="33%"
                        min="20%"
                        max="45%"
                        style={{ borderBottom: "1px solid #e8e8e8" }}
                      >
                        <div style={{ height: "100%", overflow: "auto" }}>
                          {selectedSamples.length > 0 || sampleDataLoading ? (
                            <TrajectoryViewer 
                              ref={trajectoryViewerRef}
                              sampleId={selectedSamples.length > 0 ? selectedSamples[0].id : null}
                              samples={selectedSamples}
                              kosaraDisplayEnabled={kosaraDisplayEnabled}
                              onKosaraDisplayToggle={handleKosaraDisplayToggle}
                              onGeneSelection={handleTrajectoryGeneSelection}
                              onTrajectoryGuidelineChange={handleTrajectoryGuidelineChange}
                            />
                          ) : (
                            <div style={{
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                              height: "100%",
                              color: "#999"
                            }}>
                              Select a sample to view trajectory data
                            </div>
                          )}
                        </div>
                      </Splitter.Panel>

                      <Splitter.Panel
                        defaultSize="33%"
                        min="20%"
                        max="45%"
                        style={{ borderBottom: "1px solid #e8e8e8" }}
                      >
                        <div
                          style={{
                            height: "100%",
                            display: "flex",
                            flexDirection: "column",
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              display: "grid",
                              gridTemplateColumns: "repeat(2, 1fr)",
                              gridAutoRows: "100%",
                              gap: 5,
                              maxHeight: "100%",
                              overflow: umapDataSets.length <= 2 ? "hidden" : "auto",
                            }}
                          >
                            {umapDataSets.length === 0 ? (
                              <Empty style={{ gridColumn: "1 / -1" }} description="No UMAP data available" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : (
                              umapDataSets.map((dataset, index) => {
                                // Calculate dimensions based on total count
                                const totalCount = umapDataSets.length;
                                let containerStyle = {
                                  border: "1px solid #e8e8e8",
                                  borderRadius: "4px",
                                  backgroundColor: "#fafafa",
                                  position: "relative",
                                  overflow: "hidden",
                                  height: "100%",
                                  minHeight: "200px",
                                };

                                // Determine size based on count
                                if (totalCount === 1) {
                                  containerStyle.gridColumn = "1 / -1";
                                }

                                return (
                                  <div key={dataset.id} style={containerStyle}>
                                    {/* UMAP Component Close Button */}
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CloseOutlined />}
                                      onClick={() =>
                                        setUmapDataSets((prev) =>
                                          prev.filter((d) => d.id !== dataset.id)
                                        )
                                      }
                                      style={{
                                        position: "absolute",
                                        top: "2px",
                                        right: "2px",
                                        zIndex: 10,
                                        color: "#999",
                                        width: "20px",
                                        height: "20px",
                                        minWidth: "20px",
                                        padding: 0,
                                      }}
                                    />
                                    <UmapComponent
                                      umapData={dataset.data}
                                      umapLoading={dataset.loading}
                                      title={dataset.title}
                                      adata_umap_title={dataset.adata_umap_title}
                                      hoveredCluster={hoveredCluster}
                                      setHoveredCluster={setHoveredCluster}
                                      umapId={dataset.id}
                                      sampleId={dataset.sampleId}
                                      setCellName={setCellName}
                                      setPseudotimeDataSets={setPseudotimeDataSets}
                                      setPseudotimeLoadingStates={setPseudotimeLoadingStates}
                                      setClusterColorMappings={setClusterColorMappings}
                                      hoveredTrajectory={hoveredTrajectory}
                                      coordinatesData={coordinatesData}
                                      cellTypesData={cellTypesData}
                                      setCellTypesData={setCellTypesData}
                                      selectedCellTypes={selectedCellTypes}
                                      setSelectedCellTypes={setSelectedCellTypes}
                                      cellTypeColors={cellTypeColors}
                                      setCellTypeColors={setCellTypeColors}
                                      pseudotimeDataSets={pseudotimeDataSets}
                                      pseudotimeLoadingStates={pseudotimeLoadingStates}
                                      onUmapDataUpdate={(newData, newAdataUmapTitle, newSettings, newName) =>
                                        handleUmapDataUpdate(newData, newAdataUmapTitle, newSettings, newName, dataset.id)
                                      }
                                      onUmapLoadingStart={() => handleUmapLoadingStart(dataset.id)}
                                      isUpdating={dataset.isUpdating || false}
                                      areaColor={dataset.areaColor}
                                      areaName={dataset.areaName}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </Splitter.Panel>
                      <Splitter.Panel defaultSize="33%" min="20%" max="45%">
                        <PseudotimeGlyphComponent
                          umapDataSets={umapDataSets}
                          adata_umap_title={umapDataSets.length > 0 ? umapDataSets[0].adata_umap_title : null}
                          relatedSampleIds={umapDataSets.length > 0 ? [...new Set(umapDataSets.map(d => d.sampleId))] : []}
                          pseudotimeDataSets={pseudotimeDataSets}
                          pseudotimeLoadingStates={pseudotimeLoadingStates}
                          clusterColorMappings={clusterColorMappings}
                          hoveredTrajectory={hoveredTrajectory}
                          setHoveredTrajectory={setHoveredTrajectory}
                        />
                      </Splitter.Panel>
                    </Splitter>
                  </Splitter.Panel>
                </Splitter>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  width: "100%",
                  color: "#999",
                }}
              >
                Please select at least one sample to view
              </div>
            )}
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

export default App;
