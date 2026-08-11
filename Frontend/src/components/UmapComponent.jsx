import { ScatterplotUmap } from "./ScatterPlotUmap";
import { Spin } from "antd";

export const UmapComponent = ({
  umapData,
  umapLoading,
  title,
  adata_umap_title,
  hoveredCluster,
  setHoveredCluster,
  umapId,
  sampleId,
  setCellName,
  setPseudotimeDataSets,
  setPseudotimeLoadingStates,
  setClusterColorMappings,
  hoveredTrajectory,
  coordinatesData,
  cellTypesData,
  setCellTypesData,
  selectedCellTypes,
  setSelectedCellTypes,
  cellTypeColors,
  setCellTypeColors,
  pseudotimeDataSets,
  pseudotimeLoadingStates,
  onUmapDataUpdate,
  onUmapLoadingStart,
  isUpdating = false,
  areaColor,
  areaName,
  goAnalysis
}) => {
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {umapLoading ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          width: '100%',
          height: '100%',
          padding: 5
        }}>
          <Spin size="large" />
          <div style={{ fontSize: '12px', color: '#999' }}>
            {isUpdating ? 'Updating' : 'Generating'} {title}...
          </div>
        </div>
      ) : umapData ? (
        <ScatterplotUmap
          data={umapData}
          xAccessor={(d) => d.x}
          yAccessor={(d) => d.y}
          clusterAccessor={(d) => d.cluster}
          title={title}
          adata_umap_title={adata_umap_title}
          pointSize={3}
          hoveredCluster={hoveredCluster}
          setHoveredCluster={setHoveredCluster}
          umapId={umapId}
          sampleId={sampleId}
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
          onUmapDataUpdate={onUmapDataUpdate}
          onUmapLoadingStart={onUmapLoadingStart}
          areaColor={areaColor}
          areaName={areaName}
          goAnalysis={goAnalysis}
        />
      ) : null}
    </div>
  );
};