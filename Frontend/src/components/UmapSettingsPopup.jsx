import React, { useState, useEffect, useMemo } from 'react';
import { Input, Button, AutoComplete, Select, message } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

export const UmapSettingsPopup = ({
  visible,
  setVisible,
  position,
  onUpdateSettings,
  onLoadingStart,
  sampleId,
  cellIds,
  adata_umap_title,
  currentTitle,
  data,
  clusterAccessor,
  setPseudotimeDataSets,
  setPseudotimeLoadingStates,
  pseudotimeDataSets,
  pseudotimeLoadingStates
}) => {
  const [settings, setSettings] = useState({
    n_neighbors: 10,
    n_pcas: 30,
    resolutions: 1
  });
  const [umapName, setUmapName] = useState('');
  const [loading, setLoading] = useState(false);

  // State for direct Slingshot analysis
  const [selectedStartCluster, setSelectedStartCluster] = useState(null);

  // Get available clusters for the selection box
  const availableClusters = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    const clusters = Array.from(new Set(data.map(clusterAccessor))).sort((a, b) => {
      const numA = parseInt(a.toString().replace(/\D/g, '')) || 0;
      const numB = parseInt(b.toString().replace(/\D/g, '')) || 0;
      return numA - numB;
    });
    
    return clusters.map(cluster => ({
      value: cluster,
      label: cluster
    }));
  }, [data, clusterAccessor]);

  // Function to handle direct Slingshot analysis
  const handleDirectSlingshot = async () => {
    if (!adata_umap_title || !setPseudotimeDataSets || !setPseudotimeLoadingStates) {
      console.warn("Missing required data for direct Slingshot analysis");
      return;
    }

    // Extract cluster number from selected cluster (can be empty)
    const clusterNumber = selectedStartCluster ? selectedStartCluster.toString().replace(/\D/g, '') : '';

    // Parse parameters from adata_umap_title
    let n_neighbors = 15;
    let n_pcas = 30;
    let resolutions = 1;

    try {
      const parts = adata_umap_title.split('_');
      if (parts.length >= 5) {
        // Extract the last 3 parts as the parameters
        n_neighbors = parseInt(parts[parts.length - 3]) || 15;
        n_pcas = parseInt(parts[parts.length - 2]) || 30;
        resolutions = parseFloat(parts[parts.length - 1]) || 1;
      }
    } catch (error) {
      console.warn("Could not parse parameters from adata_umap_title, using defaults", error);
    }

    // Create cache key that includes start cluster information to differentiate between auto and cluster-specific results
    const cacheKey = clusterNumber ? `${adata_umap_title}_cluster_${clusterNumber}` : adata_umap_title;

    // Check if data for this specific configuration already exists in cache
    if (pseudotimeDataSets && pseudotimeDataSets[cacheKey]) {
      setPseudotimeLoadingStates(prevStates => ({
        ...prevStates,
        [cacheKey]: true
      }));
      setPseudotimeDataSets(prevDataSets => ({ ...prevDataSets }));
      setTimeout(() => {
        setPseudotimeLoadingStates(prevStates => ({
          ...prevStates,
          [cacheKey]: false
        }));
      }, 0);
      return;
    }

    // Set loading state for this specific dataset
    setPseudotimeLoadingStates(prevStates => ({
      ...prevStates,
      [cacheKey]: true
    }));

    try {
      // Prepare request body without start_cluster if it's empty
      const requestBody = {
        sample_id: sampleId,
        cell_ids: data.map(d => d.id || d.cell_id).filter(Boolean),
        adata_umap_title: adata_umap_title,
        n_neighbors: n_neighbors,
        n_pcas: n_pcas,
        resolutions: resolutions,
      };

      // Only add start_cluster if clusterNumber is not empty
      if (clusterNumber) {
        requestBody.start_cluster = clusterNumber;
      }

      const res = await fetch("/api/get_direct_slingshot_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const responseData = await res.json();

      if (responseData.error) {
        console.error("Direct Slingshot analysis failed:", responseData.error);
        return;
      }

      // Add the new data to the datasets object with the cache key
      setPseudotimeDataSets(prevDataSets => {
        const newDataSets = {
          ...prevDataSets,
          [cacheKey]: responseData
        };
        return newDataSets;
      });
    } catch (err) {
      console.error("Failed to fetch direct Slingshot data", err);
    } finally {
      // Clear loading state for this specific dataset
      setPseudotimeLoadingStates(prevStates => ({
        ...prevStates,
        [cacheKey]: false
      }));
    }
  };

  // Get loading state for direct slingshot
  const directSlingshotLoading = useMemo(() => {
    if (!pseudotimeLoadingStates || !adata_umap_title) return false;
    
    // Check loading state for both auto mode and cluster-specific mode
    const clusterNumber = selectedStartCluster ? selectedStartCluster.toString().replace(/\D/g, '') : '';
    const cacheKey = clusterNumber ? `${adata_umap_title}_cluster_${clusterNumber}` : adata_umap_title;
    
    return pseudotimeLoadingStates[cacheKey] || false;
  }, [pseudotimeLoadingStates, adata_umap_title, selectedStartCluster]);

  // Initialize settings from current adata_umap_title when popup opens
  useEffect(() => {
    if (visible && adata_umap_title) {
      try {
        const parts = adata_umap_title.split('_');
        if (parts.length >= 5) {
          // Extract the last 3 parts as the parameters
          const n_neighbors = parseInt(parts[parts.length - 3]) || 10;
          const n_pcas = parseInt(parts[parts.length - 2]) || 30;
          const resolutions = parseFloat(parts[parts.length - 1]) || 1;

          setSettings({
            n_neighbors,
            n_pcas,
            resolutions
          });
        }
      } catch (error) {
        console.warn("Could not parse parameters from adata_umap_title, using defaults", error);
      }
    }
  }, [visible, adata_umap_title]);

  // Initialize UMAP name when popup opens
  useEffect(() => {
    if (visible && currentTitle) {
      // Extract the name part before the parentheses (e.g., "Area 1" from "Area 1 (sample_id)")
      const nameMatch = currentTitle.match(/^(.+?)\s*\(/);
      if (nameMatch) {
        setUmapName(nameMatch[1].trim());
      } else {
        setUmapName(currentTitle);
      }
    }
  }, [visible, currentTitle]);

  const handleInputChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleUpdateUMAP = async () => {
    if (!sampleId || !cellIds || cellIds.length === 0) {
      alert('No cells selected for UMAP analysis');
      return;
    }

    // Check if only the name has changed (no parameter changes)
    const parts = adata_umap_title.split('_');
    const currentNeighbors = parseInt(parts[parts.length - 3]) || 10;
    const currentPcas = parseInt(parts[parts.length - 2]) || 30;
    const currentResolutions = parseFloat(parts[parts.length - 1]) || 1;
    
    const onlyNameChanged = (
      settings.n_neighbors === currentNeighbors &&
      settings.n_pcas === currentPcas &&
      settings.resolutions === currentResolutions
    );

    if (onlyNameChanged) {
      // Only name changed, no need to call API
      onUpdateSettings(null, adata_umap_title, settings, umapName);
      setVisible(false);
      return;
    }

    // Validate settings
    if (settings.n_neighbors < 1 || settings.n_neighbors > 50) {
      alert('Number of neighbors must be between 1 and 50');
      return;
    }
    if (settings.n_pcas < 1 || settings.n_pcas > 100) {
      alert('Number of PCs must be between 1 and 100');
      return;
    }
    if (settings.resolutions < 0.1 || settings.resolutions > 5) {
      alert('Resolution must be between 0.1 and 5.0');
      return;
    }

    setLoading(true);

    // Start the loading animation in the parent component
    if (onLoadingStart) {
      onLoadingStart();
    }

    try {
      // Generate new adata_umap_title with updated parameters
      const baseName = parts.slice(0, -3).join('_'); // Remove the last 3 parts (parameters)
      const newAdataUmapTitle = `${baseName}_${settings.n_neighbors}_${settings.n_pcas}_${settings.resolutions}`;

      // Call the API to get updated UMAP data
      const response = await fetch('/api/get_umap_data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sample_id: sampleId,
          cell_ids: cellIds,
          n_neighbors: settings.n_neighbors,
          n_pcas: settings.n_pcas,
          resolutions: settings.resolutions,
          adata_umap_title: newAdataUmapTitle
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'error') {
        message.error(`UMAP update failed: ${data.message}`);
        throw new Error(data.message);
      }

      if (data.status === 'success') {
        message.success('UMAP updated successfully');
        // Call the parent callback with new data, title, settings, and name
        onUpdateSettings(data.data, newAdataUmapTitle, settings, umapName);
      } else {
        // Fallback for unexpected response format
        throw new Error('Unexpected response format from server');
      }

      // Close the popup
      setVisible(false);

    } catch (error) {
      console.error('Error updating UMAP:', error);
      message.error(`Failed to update UMAP: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      {/* Overlay to prevent interactions with the map */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999,
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          cursor: 'default',
          pointerEvents: 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation();
          setVisible(false);
        }}
      />

      <div
        style={{
          position: 'fixed',
          left: Math.min(position.x, window.innerWidth - 420),
          top: Math.min(position.y, window.innerHeight - 400),
          zIndex: 1000,
          background: '#ffffff',
          border: '1px solid #d9d9d9',
          borderRadius: 8,
          boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
          padding: 12,
          minWidth: 240,
          maxWidth: 320,
          pointerEvents: 'auto'
        }}
      >
        {/* Close button */}
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
          onClick={() => setVisible(false)}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
          onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
        >
          <CloseOutlined style={{ fontSize: 12, color: '#666' }} />
        </div>

        {/* Title */}
        <div style={{
          fontWeight: 'bold',
          marginBottom: 5,
          fontSize: 14,
          color: '#262626',
          paddingRight: 20,
          textAlign: 'left'
        }}>
          UMAP Settings
        </div>

        {/* UMAP Name Input */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#595959',
              minWidth: '100px',
              textAlign: 'left'
            }}>
              Name:
            </label>
            <Input
              value={umapName}
              onChange={(e) => setUmapName(e.target.value)}
              size="small"
              style={{ flex: 1 }}
              placeholder="Enter UMAP name"
            />
          </div>
        </div>

        {/* Number of Neighbors Input */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#595959',
              minWidth: '100px',
              textAlign: 'left'
            }}>
              Neighbors:
            </label>
            <AutoComplete
              value={settings.n_neighbors.toString()}
              onChange={(value) => handleInputChange('n_neighbors', parseInt(value) || 10)}
              options={[
                { value: '5' },
                { value: '10' },
                { value: '15' },
                { value: '20' },
                { value: '25' },
                { value: '30' },
                { value: '40' },
                { value: '50' }
              ]}
              size="small"
              style={{ flex: 1 }}
              placeholder="10"
            />
          </div>
        </div>

        {/* Number of PCs Input */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#595959',
              minWidth: '100px',
              textAlign: 'left'
            }}>
              N PCAs:
            </label>
            <AutoComplete
              value={settings.n_pcas.toString()}
              onChange={(value) => handleInputChange('n_pcas', parseInt(value) || 30)}
              options={[
                { value: '10' },
                { value: '20' },
                { value: '30' },
                { value: '40' },
                { value: '50' },
                { value: '75' },
                { value: '100' }
              ]}
              size="small"
              style={{ flex: 1 }}
              placeholder="30"
            />
          </div>
        </div>

        {/* Resolution Input */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#595959',
              minWidth: '100px',
              textAlign: 'left'
            }}>
              Resolution:
            </label>
            <AutoComplete
              value={settings.resolutions.toString()}
              onChange={(value) => handleInputChange('resolutions', parseFloat(value) || 1)}
              options={[
                { value: '0.1' },
                { value: '0.2' },
                { value: '0.3' },
                { value: '0.4' },
                { value: '0.5' },
                { value: '0.6' },
                { value: '0.7' },
                { value: '0.8' },
                { value: '0.9' },
                { value: '1.0' },
                { value: '1.5' },
                { value: '2.0' },
                { value: '3.0' },
                { value: '5.0' }
              ]}
              size="small"
              style={{ flex: 1 }}
              placeholder="1.0"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <Button
          size="small"
          style={{ marginBottom: 5, width: '100%' }}
          color="#0084F9"
          variant="outlined"
          onClick={handleUpdateUMAP}
          loading={loading}
        >
          {loading ? 'Updating...' : 'Update UMAP'}
        </Button>

        {/* Direct Slingshot Controls */}
        <div style={{ 
          marginTop: 12, 
          paddingTop: 12, 
          borderTop: '1px solid #f0f0f0' 
        }}>
          <div style={{
            fontWeight: 'bold',
            marginBottom: 8,
            fontSize: 12,
            color: '#262626',
            textAlign: 'left'
          }}>
            Direct Slingshot Analysis
          </div>
          
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#595959',
                minWidth: '100px',
                textAlign: 'left'
              }}>
                Start Cluster:
              </label>
              <Select
                placeholder="Select start cluster"
                value={selectedStartCluster}
                onChange={setSelectedStartCluster}
                style={{ flex: 1 }}
                size="small"
                options={availableClusters}
                allowClear
              />
            </div>
          </div>

          <Button
            onClick={handleDirectSlingshot}
            disabled={directSlingshotLoading}
            loading={directSlingshotLoading}
            type="primary"
            size="small"
            style={{ width: '100%' }}
          >
            {directSlingshotLoading ? 'Running...' : 'Run Slingshot'}
          </Button>
        </div>
      </div>
    </>
  );
};
