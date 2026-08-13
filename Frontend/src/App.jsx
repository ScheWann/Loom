import { useEffect, useMemo, useState, useRef } from "react";
import { Select, Spin, message, Button, Splitter, Modal, Form, Input, Upload, ConfigProvider, Empty, Switch, theme } from "antd";
import "./App.css";
import { SampleViewer } from "./components/SampleViewer";
import { PlusOutlined, InboxOutlined, PaperClipOutlined, CloseOutlined, SunOutlined, MoonOutlined } from "@ant-design/icons";
import "@ant-design/v5-patch-for-react-19";
import { UmapComponent } from "./components/UmapComponent";
import { TrajectoryViewer } from "./components/TrajectoryViewer";
import { PseudotimeGlyphComponent } from "./components/PseudotimeGlyphComponent";
import { COLOR_PALETTE } from "./components/Utils";
import { fetchExampleState } from "./components/ExampleState";
import { useAppTheme } from "./theme";

// Custom theme configuration
const lightTheme = {
  token: {
    colorPrimary: "#1890ff",
    colorPrimaryHover: "#40a9ff",
    colorPrimaryActive: "#096dd9",
  },
};

// Dark mode runs on an amber accent instead of the blue one: blue reads dull
// on the dark surfaces, and the warm accent sits better with the logo.
//
// The header buttons use antd's gold / volcano presets, which read the preset
// tokens directly — 6 is the base, 5 the hover and 7 the active shade. antd's
// dark palettes are ordered dark-to-light, so the shades are shifted here to
// keep "hover brightens, press dims" and to clear ~4.5:1 on the dark surface.
//
// Amber needs dark text on top of it rather than antd's white, which is what
// the component tokens below fix (primary buttons, checkbox ticks, the switch).
const darkTheme = {
  token: {
    colorPrimary: "#ffc069",
    colorPrimaryHover: "#ffd591",
    colorPrimaryActive: "#d48806",
    gold6: "#e8b339",
    gold5: "#f3cc62",
    gold7: "#d89614",
    volcano6: "#e87040",
    volcano5: "#f3956a",
    volcano7: "#d84a1b",
  },
  components: {
    Button: { primaryColor: "#2b1d00" },
    Checkbox: { colorWhite: "#2b1d00" },
    Switch: { colorTextLightSolid: "#2b1d00" },
  },
};

function App() {
  // Dark mode state
  const { darkMode, setDarkMode } = useAppTheme();
  const antdTheme = useMemo(
    () => ({
      ...(darkMode ? darkTheme : lightTheme),
      algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    }),
    [darkMode]
  );

  // antd's static APIs (message.*) render outside the React tree, so they don't
  // see the ConfigProvider below and need the theme handed to them separately.
  useEffect(() => {
    ConfigProvider.config({
      holderRender: (children) => (
        <ConfigProvider theme={antdTheme}>{children}</ConfigProvider>
      ),
    });
  }, [antdTheme]);

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
  const [regionColorMappings, setRegionColorMappings] = useState({});

  // Ref for TrajectoryViewer to call refresh
  const trajectoryViewerRef = useRef(null);

  // Ref for SampleViewer, used to restore the example ROI
  const sampleViewerRef = useRef(null);

  // Ref for PseudotimeGlyphComponent, used to restore its gene selection
  const pseudotimeGlyphRef = useRef(null);

  // Fixed example state
  const [exampleLoading, setExampleLoading] = useState(false);
  const [pendingExample, setPendingExample] = useState(null); // Snapshot waiting for the viewers to mount
  const [exampleGoAnalysis, setExampleGoAnalysis] = useState({}); // {adata_umap_title: {clusterId: [terms]}}
  const exampleCompletionPendingRef = useRef(false);
  const exampleSnapshotAppliedRef = useRef(false);
  const exampleImagesLoadedRef = useRef(false);

  const finishExampleLoadIfReady = () => {
    if (
      exampleCompletionPendingRef.current &&
      exampleSnapshotAppliedRef.current &&
      exampleImagesLoadedRef.current
    ) {
      exampleCompletionPendingRef.current = false;
      setExampleLoading(false);
      message.success("Example data loaded");
    }
  };

  // Clear all caches on initial page load
  useEffect(() => {
    const clearAllCachesOnMount = async () => {
      try {
        await fetch("/api/clear_all_caches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        console.log("All caches cleared on page load");
      } catch (error) {
        console.error("Error clearing caches on page load:", error);
      }
    };

    clearAllCachesOnMount();
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
        // A manual confirm hands the trajectory selectors back to the normal cascade.
        setExampleGoAnalysis({});
        trajectoryViewerRef.current?.clearExampleSelection?.();
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

  // Load the pre-recorded example session. Display only: the sample coordinates and
  // images come from the backend, everything else is replayed from fixed data.
  const loadExample = async () => {
    if (exampleLoading || sampleDataLoading) {
      return;
    }

    setExampleLoading(true);
    exampleSnapshotAppliedRef.current = false;
    exampleImagesLoadedRef.current = false;

    try {
      const snapshot = await fetchExampleState();
      const sampleIds = snapshot.samples;

      setSampleDataLoading(true);
      await clearCache();

      const cacheResponse = await fetch("/api/load_adata_cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_ids: sampleIds }),
      });

      if (!cacheResponse.ok) {
        const errorData = await cacheResponse.json();
        throw new Error(`Failed to load data cache: ${errorData.error}`);
      }

      await fetchCoordinates(sampleIds);

      // fetchCoordinates resets cell type selection/colors, so restore the recorded ones after it.
      if (snapshot.selectedCellTypes && Object.keys(snapshot.selectedCellTypes).length > 0) {
        setSelectedCellTypes(snapshot.selectedCellTypes);
      }
      if (snapshot.cellTypeColors && Object.keys(snapshot.cellTypeColors).length > 0) {
        setCellTypeColors(snapshot.cellTypeColors);
      }

      setExampleGoAnalysis(snapshot.goAnalysis || {});
      setUmapDataSets(snapshot.umapDataSets || []);
      setPseudotimeDataSets(snapshot.pseudotimeDataSets || {});
      setPseudotimeLoadingStates({});
      setClusterColorMappings(snapshot.clusterColorMappings || {});
      setTempSamples(sampleIds);
      // From this point on, wait for the newly selected sample's TissueView images.
      exampleCompletionPendingRef.current = true;
      exampleImagesLoadedRef.current = false;
      setSelectedSamples(sampleIds.map((sample) => ({ id: sample, name: sample })));

      // The viewers only mount once selectedSamples is set, so hand over from an effect.
      setPendingExample(snapshot);
    } catch (error) {
      exampleCompletionPendingRef.current = false;
      message.error(`Failed to load example: ${error.message}`);
      setSampleDataLoading(false);
      setExampleLoading(false);
    }
  };

  // Push the snapshot into the viewers once they are mounted.
  useEffect(() => {
    if (!pendingExample || selectedSamples.length === 0) {
      return;
    }

    sampleViewerRef.current?.applyExampleSnapshot(pendingExample.sampleViewer);
    trajectoryViewerRef.current?.applyExampleSnapshot(pendingExample.trajectoryViewer);
    pseudotimeGlyphRef.current?.applyExampleSnapshot(pendingExample.pseudotimeGlyph);
    exampleSnapshotAppliedRef.current = true;
    setPendingExample(null);
    finishExampleLoadIfReady();
  }, [pendingExample, selectedSamples]);

  // Callback to be called when all images are loaded
  const onImagesLoaded = () => {
    setSampleDataLoading(false);
    if (exampleCompletionPendingRef.current) {
      exampleImagesLoadedRef.current = true;
      finishExampleLoadIfReady();
    }
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
      const response = await fetch("/api/upload_spaceranger", {
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

  // Remove one UMAP dataset and eagerly clean its color mapping.
  const handleCloseUmapDataset = (datasetToRemove) => {
    setUmapDataSets(prev => prev.filter((d) => d.id !== datasetToRemove.id));
    setClusterColorMappings(prev => {
      if (!datasetToRemove?.adata_umap_title || !prev[datasetToRemove.adata_umap_title]) {
        return prev;
      }
      const next = { ...prev };
      delete next[datasetToRemove.adata_umap_title];
      return next;
    });

    const umapLabel = datasetToRemove?.title || datasetToRemove?.adata_umap_title || "UMAP plot";
    message.success(`Deleted UMAP plot "${umapLabel}".`);
  };

  // Keep color mappings in sync with currently rendered UMAP datasets.
  useEffect(() => {
    const activeTitles = new Set(
      umapDataSets
        .map(dataset => dataset.adata_umap_title)
        .filter(Boolean)
    );

    setClusterColorMappings(prev => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        if (activeTitles.has(key)) {
          next[key] = prev[key];
        }
      });
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [umapDataSets]);

  // Clear hovered cluster if its source UMAP dataset no longer exists.
  useEffect(() => {
    if (!hoveredCluster?.umapId) {
      return;
    }

    const exists = umapDataSets.some(dataset => dataset.id === hoveredCluster.umapId);
    if (!exists) {
      setHoveredCluster(null);
    }
  }, [umapDataSets, hoveredCluster]);

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
  const handleAreaSaved = (sampleId, regionName, areaColor, previousRegionName = null) => {
    if (sampleId && regionName && areaColor) {
      setRegionColorMappings((prev) => {
        const next = { ...prev };
        if (previousRegionName && previousRegionName !== regionName) {
          delete next[`${sampleId}::${previousRegionName}`];
        }
        next[`${sampleId}::${regionName}`] = areaColor;
        return next;
      });
    }
    if (trajectoryViewerRef.current) {
      trajectoryViewerRef.current.refreshRegions(sampleId);
    }
  };

  // Handler for area deletion - clear TrajectoryViewer datasets and selectors tied to the deleted region
  const handleAreaDeleted = (sampleId, regionName) => {
    setRegionColorMappings((prev) => {
      const next = { ...prev };
      delete next[`${sampleId}::${regionName}`];
      return next;
    });
    if (trajectoryViewerRef.current?.clearAreaRelatedData) {
      trajectoryViewerRef.current.clearAreaRelatedData(sampleId, regionName);
    }

    const relatedUmapTitles = (umapDataSets || [])
      .filter((dataset) => dataset.sampleId === sampleId && dataset.areaName === regionName)
      .map((dataset) => dataset.adata_umap_title)
      .filter(Boolean);

    if (relatedUmapTitles.length === 0) {
      return { relatedPseudotimeCount: 0 };
    }

    const isRelatedPseudotimeKey = (key) =>
      relatedUmapTitles.some((title) => key === title || key.startsWith(`${title}_cluster_`));

    const relatedPseudotimeCount = Object.keys(pseudotimeDataSets || {}).filter(isRelatedPseudotimeKey).length;

    setPseudotimeDataSets((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([key, value]) => {
        if (!isRelatedPseudotimeKey(key)) {
          next[key] = value;
        }
      });
      return next;
    });

    setPseudotimeLoadingStates((prev) => {
      const next = {};
      Object.entries(prev || {}).forEach(([key, value]) => {
        if (!isRelatedPseudotimeKey(key)) {
          next[key] = value;
        }
      });
      return next;
    });

    setHoveredTrajectory((prev) => {
      if (!prev) {
        return prev;
      }

      const hoveredKey = prev.adata_umap_title || prev.source_title;
      if (hoveredKey && isRelatedPseudotimeKey(hoveredKey)) {
        return null;
      }

      return prev;
    });

    return { relatedPseudotimeCount };
  };

  return (
    <ConfigProvider theme={antdTheme}>
      <div className="App">
        <div className="main">
          {/* top bar */}
          <div className="topBar">
            <div className="appTitle">
              {/* The light logo is a white-background image, so dark mode uses a
                  transparent variant with a white wordmark instead. */}
              <img
                src={`${import.meta.env.BASE_URL}${darkMode ? "Loom_name_dark.png" : "Loom_name.png"}`}
                alt="Loom"
                className="appLogo"
              />
            </div>
            {/* select samples */}
            <div className="selectSamples">
              <Select
                className="sample-multi-select app-sample-select"
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
              {/* <Button
                size="small"
                onClick={() => setUploadFormVisible(true)}
                icon={<PlusOutlined />}
              /> */}
              <Button
                size="small"
                color={darkMode ? "gold" : "blue"}
                variant="outlined"
                onClick={confirmSamples}
              >
                Confirm
              </Button>
              <Button
                size="small"
                color={darkMode ? "volcano" : "purple"}
                variant="outlined"
                onClick={loadExample}
                title="Load a pre-computed example: sample, ROI, UMAP, pseudotime and spatial trajectory"
              >
                Example
              </Button>
            </div>
            {/* dark mode toggle */}
            <div className="themeToggle">
              <Switch
                size="small"
                checked={darkMode}
                onChange={(checked) => setDarkMode(checked)}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
                title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle dark mode"
              />
            </div>
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
                  <Splitter.Panel defaultSize="60%" min="50%" max="80%">
                    <SampleViewer
                      ref={sampleViewerRef}
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
                      clusterColorMappings={clusterColorMappings}
                      onImagesLoaded={onImagesLoaded}
                      kosaraDisplayEnabled={kosaraDisplayEnabled}
                      trajectoryGenes={trajectoryGenes}
                      trajectoryGenesSample={trajectoryGenesSample}
                      trajectoryGuideline={trajectoryGuideline}
                      onTrajectoryAnalysisComplete={handleTrajectoryAnalysisComplete}
                      onAreaSaved={handleAreaSaved}
                      onAreaDeleted={handleAreaDeleted}
                    />
                  </Splitter.Panel>
                  <Splitter.Panel defaultSize="40%" min="20%" max="50%">
                    <Splitter lazy layout="vertical">
                      <Splitter.Panel
                        defaultSize="33%"
                        min="20%"
                        max="45%"
                        style={{ borderBottom: "1px solid var(--app-border)" }}
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
                              onTrajectoryAnalysisComplete={handleTrajectoryAnalysisComplete}
                              regionColorMappings={regionColorMappings}
                              umapDataSets={umapDataSets}
                            />
                          ) : (
                            <div style={{
                              display: "flex",
                              justifyContent: "center",
                              alignItems: "center",
                              height: "100%",
                              color: "var(--app-text-muted)"
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
                        style={{ borderBottom: "1px solid var(--app-border)" }}
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
                              <div
                                style={{
                                  gridColumn: "1 / -1",
                                  height: "100%",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Empty
                                  description="No UMAP data available"
                                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                                />
                              </div>
                            ) : (
                              umapDataSets.map((dataset, index) => {
                                // Calculate dimensions based on total count
                                const totalCount = umapDataSets.length;
                                let containerStyle = {
                                  border: "1px solid var(--app-border)",
                                  borderRadius: "4px",
                                  backgroundColor: "var(--app-surface-subtle)",
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
                                      onClick={() => handleCloseUmapDataset(dataset)}
                                      style={{
                                        position: "absolute",
                                        top: "5px",
                                        right: "2px",
                                        zIndex: 10,
                                        color: "var(--app-text-muted)",
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
                                      goAnalysis={exampleGoAnalysis[dataset.adata_umap_title]}
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
                          ref={pseudotimeGlyphRef}
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
                  color: "var(--app-text-muted)",
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
