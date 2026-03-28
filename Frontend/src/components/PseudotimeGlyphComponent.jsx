import { PseudotimeGlyph } from './PseudotimeGlyph';
import { Empty, Spin, Select, Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useState, useEffect, useRef, useMemo } from 'react';
import { debounce } from './Utils';

export const PseudotimeGlyphComponent = ({
    adata_umap_title,
    pseudotimeDataSets,
    pseudotimeLoadingStates,
    relatedSampleIds,
    clusterColorMappings,
    hoveredTrajectory,
    setHoveredTrajectory,
    umapDataSets,
    roiCellIds = null, // Optional ROI cell IDs for region-specific analysis (deprecated - now using umapDataSets directly)
}) => {
    // State for tracking selected glyphs
    const [selectedGlyphs, setSelectedGlyphs] = useState(new Set());

    // State for selected genes (multiple selection)
    const [selectedGenes, setSelectedGenes] = useState([]);

    // State for hiding/closing glyphs - tracked by stable key (source_title)
    const [hiddenGlyphs, setHiddenGlyphs] = useState(new Set());

    // State for highly variable genes per ROI
    const [highVariableGenesByRoi, setHighVariableGenesByRoi] = useState({}); // {roiKey: geneList}

    // Remote search state for gene Select
    const [searchQuery, setSearchQuery] = useState('');
    const [displayOptions, setDisplayOptions] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // State for gene expression analysis
    const [geneExpressionData, setGeneExpressionData] = useState([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [componentError, setComponentError] = useState(null);

    // Ref to track which ROIs have been fetched
    const fetchedRoisRef = useRef(new Set());
    
    // Ref to prevent concurrent fetches
    const isFetchingRef = useRef(false);
    
    // Ref to track the current fetch signature
    const currentFetchSignatureRef = useRef('');

    // Memoize the sample IDs to prevent unnecessary re-fetching
    const memoizedSampleIds = useMemo(() => {
        return [...relatedSampleIds].sort(); // Sort for consistent comparison
    }, [relatedSampleIds]);

    // Extract ROI information from umapDataSets
    const roiDataSets = useMemo(() => {
        if (!umapDataSets || !Array.isArray(umapDataSets)) return [];
        
        return umapDataSets.map(dataset => {
            const cellIds = dataset.data?.map(point => point.id || point.cell_id).filter(Boolean) || [];
            return {
                roiKey: dataset.adata_umap_title || dataset.title || 'unknown',
                displayName: dataset.title || dataset.adata_umap_title || 'Unknown ROI',
                cellIds: cellIds,
                sampleId: dataset.sampleId
            };
        }).filter(roi => roi.cellIds.length > 0); // Only include ROIs with cells
    }, [umapDataSets]);

    // Load highly variable genes for each ROI separately
    useEffect(() => {
        const fetchHighVariableGenesForRois = async () => {
            // Create a signature for this fetch to prevent duplicate runs
            const fetchSignature = `${memoizedSampleIds.join(',')}|${roiDataSets.map(r => `${r.roiKey}:${r.cellIds.length}`).join('|')}`;
            
            // Check if this exact fetch is already running or has been completed
            if (isFetchingRef.current || currentFetchSignatureRef.current === fetchSignature) {
                return;
            }
            
            if (memoizedSampleIds.length === 0 || roiDataSets.length === 0) {
                setHighVariableGenesByRoi({});
                fetchedRoisRef.current.clear();
                currentFetchSignatureRef.current = '';
                return;
            }
            
            isFetchingRef.current = true;
            currentFetchSignatureRef.current = fetchSignature;

            const newHighVariableGenesByRoi = {};
            const fetchPromises = [];
            let actualFetchCount = 0;

            // Fetch highly variable genes for each ROI separately
            for (const roiData of roiDataSets) {
                // Use ROI-specific sample IDs for cache key to avoid redundant calls
                const roiSampleIds = roiData.sampleId ? [roiData.sampleId] : memoizedSampleIds;
                const roiCacheKey = `${roiSampleIds.join(',')}|${roiData.roiKey}|${JSON.stringify([...roiData.cellIds].sort())}`;
                
                // Skip if we've already fetched for this exact ROI
                if (fetchedRoisRef.current.has(roiCacheKey)) {
                    continue;
                }
                
                actualFetchCount++;

                const fetchPromise = (async () => {
                    try {
                        const requestBody = {
                            sample_ids: roiSampleIds,
                            top_n: 20,
                            cell_ids: roiData.cellIds
                        };

                        const response = await fetch("/api/get_highly_variable_genes", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify(requestBody),
                        });

                        if (response.ok) {
                            const data = await response.json();

                            // Convert the response to the format expected by the select component
                            const geneList = [];
                            Object.entries(data).forEach(([sampleId, genes]) => {
                                genes.forEach(gene => {
                                    geneList.push({
                                        value: `${sampleId}_${gene}`,
                                        label: gene,
                                        sampleId: sampleId,
                                        roiKey: roiData.roiKey
                                    });
                                });
                            });

                            newHighVariableGenesByRoi[roiData.roiKey] = geneList;
                            fetchedRoisRef.current.add(roiCacheKey);
                        } else {
                            console.error(`Failed to fetch highly variable genes for ROI: ${roiData.displayName}`);
                            newHighVariableGenesByRoi[roiData.roiKey] = [];
                        }
                    } catch (error) {
                        console.error(`Error fetching highly variable genes for ROI ${roiData.displayName}:`, error);
                        newHighVariableGenesByRoi[roiData.roiKey] = [];
                    }
                })();

                fetchPromises.push(fetchPromise);
            }

            // Wait for all ROI fetches to complete
            await Promise.all(fetchPromises);

            // Update state with new ROI-specific highly variable genes
            if (Object.keys(newHighVariableGenesByRoi).length > 0) {
                setHighVariableGenesByRoi(prev => ({
                    ...prev,
                    ...newHighVariableGenesByRoi
                }));
            }
            
            isFetchingRef.current = false;
        };

        fetchHighVariableGenesForRois().catch(error => {
            console.error('Error in fetchHighVariableGenesForRois:', error);
            isFetchingRef.current = false;
            // Don't reset currentFetchSignatureRef on error to prevent retry loops
        });
        
        // Cleanup function to reset state when dependencies change significantly
        return () => {
            if (isFetchingRef.current) {
                isFetchingRef.current = false;
            }
        };
    }, [memoizedSampleIds, roiDataSets]); // Depend on roiDataSets instead of cacheKey

    // Combine all highly variable genes from all ROIs for the select options
    const allHighVariableGenes = useMemo(() => {
        const allGenes = [];
        Object.values(highVariableGenesByRoi).forEach(geneList => {
            allGenes.push(...geneList);
        });
        return allGenes;
    }, [highVariableGenesByRoi]);

    // Group genes by ROI and then by sample ID for the select options
    const hvgGroupedOptions = useMemo(() => {
        if (roiDataSets.length === 0) {
            // Fallback: group by sample ID only
            const geneOptions = allHighVariableGenes.reduce((groups, gene) => {
                if (!groups[gene.sampleId]) {
                    groups[gene.sampleId] = [];
                }
                groups[gene.sampleId].push({
                    label: gene.label,
                    value: gene.value
                });
                return groups;
            }, {});

            return Object.entries(geneOptions).map(([sampleId, genes]) => ({
                label: sampleId,
                options: genes
            }));
        }

        // Group by ROI first, then by sample
        const roiGroups = [];
        
        roiDataSets.forEach(roiData => {
            const roiGenes = highVariableGenesByRoi[roiData.roiKey] || [];
            if (roiGenes.length > 0) {
                // Group genes by sample within this ROI
                const sampleGroups = roiGenes.reduce((groups, gene) => {
                    if (!groups[gene.sampleId]) {
                        groups[gene.sampleId] = [];
                    }
                    groups[gene.sampleId].push({
                        label: gene.label,
                        value: gene.value
                    });
                    return groups;
                }, {});

                // If multiple samples in this ROI, create sub-groups
                if (Object.keys(sampleGroups).length > 1) {
                    roiGroups.push({
                        label: `${roiData.displayName}`,
                        options: Object.entries(sampleGroups).map(([sampleId, genes]) => ({
                            label: `${sampleId}`,
                            options: genes
                        }))
                    });
                } else {
                    // Single sample in ROI, use ROI name directly
                    roiGroups.push({
                        label: `${roiData.displayName}`,
                        options: Object.values(sampleGroups)[0] || []
                    });
                }
            }
        });

        return roiGroups;
    }, [allHighVariableGenes, roiDataSets, highVariableGenesByRoi]);

    // Cascade cleanup when one or more ROI-backed UMAP datasets are removed.
    // This keeps local selectors/analysis state aligned with App-level deletions.
    const previousRoiKeysRef = useRef(new Set());
    useEffect(() => {
        const currentRoiKeys = new Set(
            (umapDataSets || [])
                .map(dataset => dataset?.adata_umap_title)
                .filter(Boolean)
        );

        const removedRoiKeys = [...previousRoiKeysRef.current].filter(key => !currentRoiKeys.has(key));

        if (removedRoiKeys.length > 0) {
            const isRemovedPseudotimeKey = (key) =>
                removedRoiKeys.some(baseKey => key === baseKey || key.startsWith(`${baseKey}_cluster_`));

            // Selection is index-based; safest behavior on ROI removal is full clear.
            setSelectedGlyphs(new Set());
            setSelectedGenes([]);
            setSearchQuery('');
            setDisplayOptions(hvgGroupedOptions);

            // Drop trajectory gene-expression traces tied to removed ROI pseudotime keys.
            setGeneExpressionData(prev => prev.filter(item => !isRemovedPseudotimeKey(item?.adata_umap_title || '')));

            if (hoveredTrajectory && (hoveredTrajectory.adata_umap_title || hoveredTrajectory.source_title)) {
                const hoveredKey = hoveredTrajectory.adata_umap_title || hoveredTrajectory.source_title;
                if (isRemovedPseudotimeKey(hoveredKey)) {
                    setHoveredTrajectory?.(null);
                }
            }
        }

        previousRoiKeysRef.current = currentRoiKeys;
    }, [umapDataSets, hvgGroupedOptions, hoveredTrajectory, setHoveredTrajectory]);

    // Keep displayOptions in sync with HVGs when not actively searching
    useEffect(() => {
        if (!searchQuery) {
            setDisplayOptions(hvgGroupedOptions);
        }
    }, [hvgGroupedOptions, searchQuery]);

    // Helper to build grouped options from raw results
    const buildGroupedOptions = (records) => {
        const grouped = records.reduce((acc, item) => {
            const sid = item.sampleId;
            if (!acc[sid]) acc[sid] = [];
            acc[sid].push({ label: item.label, value: item.value });
            return acc;
        }, {});
        return Object.entries(grouped).map(([sampleId, genes]) => ({ label: sampleId, options: genes }));
    };

    // Debounced remote search for genes across provided samples
    const performGeneSearch = async (value) => {
        setSearchLoading(true);
        try {
            const response = await fetch('/api/get_gene_name_search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sample_ids: memoizedSampleIds,
                    query: value,
                    limit: 80,
                }),
            });
            if (response.ok) {
                const data = await response.json();
                // Transform to flat records then group
                const records = [];
                Object.entries(data || {}).forEach(([sid, genes]) => {
                    (genes || []).forEach((g) => {
                        records.push({
                            value: `${sid}_${g}`,
                            label: g,
                            sampleId: sid,
                        });
                    });
                });
                setDisplayOptions(buildGroupedOptions(records));
            } else {
                setDisplayOptions([]);
            }
        } catch (e) {
            console.error('Gene search failed:', e);
            setDisplayOptions([]);
        } finally {
            setSearchLoading(false);
        }
    };

    // Create debounced version of the search function
    const debouncedGeneSearch = useMemo(() => 
        debounce(performGeneSearch, 250), 
        [memoizedSampleIds]
    );

    const handleGeneSearch = (value) => {
        setSearchQuery(value);

        // If search text is empty, show HVGs
        if (!value || value.trim().length === 0) {
            setSearchLoading(false);
            setDisplayOptions(hvgGroupedOptions);
            return;
        }

        // Avoid spamming backend for very short queries
        if (value.trim().length < 2) {
            return;
        }

        // Use the debounced search function
        debouncedGeneSearch(value);
    };

    // Handle glyph selection
    const handleGlyphSelection = (glyphIndex, isSelected) => {
        const newSelected = new Set(selectedGlyphs);
        if (isSelected) {
            newSelected.add(glyphIndex);
        } else {
            newSelected.delete(glyphIndex);
        }
        setSelectedGlyphs(newSelected);
    };

    // Handle closing a glyph (hide it and unselect if selected)
    const handleCloseGlyph = (glyphKey) => {
        setHiddenGlyphs((prev) => {
            const next = new Set(prev);
            next.add(glyphKey);
            return next;
        });
        // Unselect any glyphs that correspond to this key (by index)
        setSelectedGlyphs((prev) => {
            const next = new Set(prev);
            // Selection is tracked by index; we cannot reliably map back here, so keep as-is.
            return next;
        });
    };

    // Prune hidden glyphs when datasets change (but preserve user's hide choices during loading)
    useEffect(() => {
        // Only prune hidden keys that are no longer present in the datasets
        const currentKeys = new Set(Object.keys(pseudotimeDataSets || {}));
        setHiddenGlyphs((prev) => {
            const next = new Set();
            prev.forEach((k) => {
                if (currentKeys.has(k)) next.add(k);
            });
            return next;
        });
    }, [pseudotimeDataSets]);

    // Track previous loading states to detect when specific analyses complete
    const prevLoadingStatesRef = useRef({});
    
    // Automatically unhide glyphs when specific pseudotime analysis completes
    // This ensures that when user clicks "Run Slingshot", only the target glyph becomes visible
    useEffect(() => {
        const currentLoadingStates = pseudotimeLoadingStates || {};
        const prevLoadingStates = prevLoadingStatesRef.current;
        
        // Find keys where loading state changed from true to false (analysis completed)
        const completedAnalyses = Object.keys(currentLoadingStates).filter(key => {
            return prevLoadingStates[key] === true && currentLoadingStates[key] === false;
        });
        
        if (completedAnalyses.length > 0) {
            setHiddenGlyphs((prev) => {
                const next = new Set(prev);
                let hasChanges = false;
                
                // Only unhide glyphs for analyses that just completed and have actual data
                completedAnalyses.forEach((key) => {
                    const dataset = pseudotimeDataSets?.[key];
                    
                    // Only unhide if we have actual data and it was previously hidden
                    if (dataset && prev.has(key)) {
                        next.delete(key);
                        hasChanges = true;
                    }
                });
                
                return hasChanges ? next : prev;
            });
        }
        
        // Update the previous loading states for next comparison
        prevLoadingStatesRef.current = { ...currentLoadingStates };
    }, [pseudotimeLoadingStates, pseudotimeDataSets]);

    // Helper function to extract UMAP parameters from adata_umap_title
    const extractUmapParameters = (adataUmapTitle) => {
        if (!adataUmapTitle || typeof adataUmapTitle !== 'string') {
            return { n_neighbors: 10, n_pcas: 30, resolutions: 1 }; // defaults
        }
        
        try {
            const parts = adataUmapTitle.split('_');
            if (parts.length >= 3) {
                // Extract the last 3 parts as the parameters
                const n_neighbors = parseInt(parts[parts.length - 3]) || 10;
                const n_pcas = parseInt(parts[parts.length - 2]) || 30;
                const resolutions = parseFloat(parts[parts.length - 1]) || 1;
                return { n_neighbors, n_pcas, resolutions };
            }
        } catch (error) {
            console.warn("Could not parse UMAP parameters from adata_umap_title:", adataUmapTitle, error);
        }
        
        return { n_neighbors: 10, n_pcas: 30, resolutions: 1 }; // fallback defaults
    };

    // Helper function to extract display name and sample ID for consistent formatting
    const getConsistentDisplayTitle = (baseTitle, umapDataSets) => {        
        if (!umapDataSets || !Array.isArray(umapDataSets)) {
            // If no UMAP datasets, try to extract area name from baseTitle
            return extractAreaNameFromTitle(baseTitle);
        }
        
        // Find the matching UMAP dataset
        const matchingUmapDataset = umapDataSets.find(dataset =>
            dataset.adata_umap_title === baseTitle || dataset.title === baseTitle
        );
        
        if (matchingUmapDataset) {
            // If we have areaName property, use it directly
            if (matchingUmapDataset.areaName) {
                return matchingUmapDataset.areaName;
            }
            
            // Otherwise extract from title format "${areaName} (${sampleId})"
            if (matchingUmapDataset.title) {
                const titleMatch = matchingUmapDataset.title.match(/^(.+?)\s*\(/);
                if (titleMatch) {
                    return titleMatch[1]; // Return just the area name part
                }
            }
        }
        
        // Fallback: extract area name from the baseTitle
        return extractAreaNameFromTitle(baseTitle);
    };

    // Helper function to extract area name from various title formats
    const extractAreaNameFromTitle = (title) => {
        if (!title || typeof title !== 'string') {
            return title;
        }
        
        // If it's already in the desired format (no underscores, just spaces), return as-is
        if (!title.includes('_')) {
            return title;
        }
        
        // Try to extract area name from adata_umap_title format
        // Pattern: {areaName}_{sampleId}_{param1}_{param2}_{param3}
        const sampleIdMatch = title.match(/(skin_[A-Z0-9]+_[A-Z0-9]+)/);
        if (sampleIdMatch) {
            const sampleId = sampleIdMatch[1];
            const parts = title.split('_');
            const sampleIdParts = sampleId.split('_');
            
            // Find where the sample ID starts in the parts array
            const sampleIdStartIndex = parts.findIndex((part, index) => {
                return parts.slice(index, index + sampleIdParts.length).join('_') === sampleId;
            });
            
            if (sampleIdStartIndex > 0) {
                // Everything before the sample ID is the area name
                const nameParts = parts.slice(0, sampleIdStartIndex);
                return nameParts.join(' ').replace(/_/g, ' ');
            }
        }
        
        // If pattern doesn't match, try to clean up the title by removing common sample patterns
        const cleanTitle = title.replace(/(skin_[A-Z0-9]+_[A-Z0-9]+).*$/, '').replace(/_+$/, '');
        return cleanTitle.replace(/_/g, ' ');
    };

    // Convert pseudotimeDataSets object to separate trajectory data for each UMAP
    const allPseudotimeData = [];

    try {
        // Process each UMAP dataset separately to create individual glyphs
        Object.entries(pseudotimeDataSets).forEach(([title, pseudotimeData]) => {
            // Handle both new structure {cluster_order, trajectory_objects} and old array structure
            let hasValidData = false;
            let trajectoryObjects = [];

            if (pseudotimeData && typeof pseudotimeData === 'object') {
                if (pseudotimeData.trajectory_objects && Array.isArray(pseudotimeData.trajectory_objects) && pseudotimeData.trajectory_objects.length > 0) {
                    hasValidData = true;
                    trajectoryObjects = pseudotimeData.trajectory_objects;
                }
            }

            if (hasValidData) {
                // Get consistent display title using helper function
                let displayTitle = getConsistentDisplayTitle(title, umapDataSets);
                
                // Extract UMAP parameters from the title
                const umapParameters = extractUmapParameters(title);

                // Process trajectories for this specific UMAP dataset
                const processedTrajectories = trajectoryObjects.map((trajectoryData) => {
                    // Ensure sampleId is set - try multiple fallback strategies
                    let sampleId = trajectoryData.sampleId;

                    // First fallback: try relatedSampleIds
                    if (!sampleId && relatedSampleIds.length > 0) {
                        sampleId = relatedSampleIds[0];
                    }

                    // Second fallback: try to extract from title (format: prefix_sampleId_suffix)
                    if (!sampleId) {
                        const titleToCheck = title || adata_umap_title;
                        if (titleToCheck && typeof titleToCheck === 'string') {
                            // Look for patterns like skin_TXK6Z4X_A1 or similar
                            const match = titleToCheck.match(/(skin_[A-Z0-9]+_[A-Z0-9]+)/);
                            if (match) {
                                sampleId = match[1];
                            }
                        }
                    }

                    return {
                        ...trajectoryData,
                        sampleId: sampleId
                    };
                });

                // Create a separate glyph entry for this UMAP dataset
                // Extract original adata_umap_title for area color mapping
                const originalAdataTitle = title.includes('_cluster_') 
                    ? title.replace(/_cluster_\d+$/, '') 
                    : title;
                
                allPseudotimeData.push({
                    mergedTrajectories: processedTrajectories,
                    source_title: title,
                    display_title: displayTitle,
                    isLoading: false,
                    isPlaceholder: false,
                    fullPseudotimeData: pseudotimeData,
                    umapParameters: umapParameters,
                    originalAdataTitle: originalAdataTitle
                });
            }
        });

        // Check if there's any loading happening
        const isLoading = Object.values(pseudotimeLoadingStates).some(loading => loading);

        // Add loading placeholders for UMAP datasets that are currently loading
        if (umapDataSets && Array.isArray(umapDataSets)) {
            umapDataSets.forEach((umapDataset) => {
                // Check for loading states with both original key and cluster-specific keys
                const baseKey = umapDataset.adata_umap_title;
                const isBaseLoading = pseudotimeLoadingStates[baseKey];
                
                // Check for any cluster-specific loading states for this dataset
                const isClusterSpecificLoading = Object.keys(pseudotimeLoadingStates).some(key => 
                    key.startsWith(`${baseKey}_cluster_`) && pseudotimeLoadingStates[key]
                );
                
                const isThisDatasetLoading = isBaseLoading || isClusterSpecificLoading;
                
                // Check specifically for the loading configuration we're interested in
                let hasDataForThisConfiguration = false;
                
                if (isBaseLoading && !isClusterSpecificLoading) {
                    // Loading auto mode - check if we have data for base key
                    hasDataForThisConfiguration = allPseudotimeData.some(data => data.source_title === baseKey);
                } else if (isClusterSpecificLoading) {
                    // Loading cluster-specific mode - check if we have data for the specific cluster key(s)
                    const clusterLoadingKeys = Object.keys(pseudotimeLoadingStates).filter(key => 
                        key.startsWith(`${baseKey}_cluster_`) && pseudotimeLoadingStates[key]
                    );
                    
                    hasDataForThisConfiguration = clusterLoadingKeys.some(clusterKey =>
                        allPseudotimeData.some(data => data.source_title === clusterKey)
                    );
                }

                // If pseudotime is loading and we don't have data for this specific configuration, add a loading placeholder
                if (isThisDatasetLoading && !hasDataForThisConfiguration) {
                    const consistentTitle = getConsistentDisplayTitle(umapDataset.adata_umap_title, umapDataSets);
                    const umapParams = extractUmapParameters(umapDataset.adata_umap_title);
                    
                    // Find the specific loading key to use as source_title
                    let loadingKey = baseKey;
                    if (isClusterSpecificLoading && !isBaseLoading) {
                        // Find the cluster-specific key that's currently loading
                        loadingKey = Object.keys(pseudotimeLoadingStates).find(key => 
                            key.startsWith(`${baseKey}_cluster_`) && pseudotimeLoadingStates[key]
                        ) || baseKey;
                    }
                    
                    allPseudotimeData.push({
                        source_title: loadingKey,
                        display_title: consistentTitle,
                        isLoading: true,
                        isPlaceholder: true,
                        umapParameters: umapParams,
                        originalAdataTitle: baseKey // Keep track of original title for area color mapping
                    });
                }
            });
        }

        // If no data at all but loading, show generic loading placeholder
        if (allPseudotimeData.length === 0 && isLoading) {
            allPseudotimeData.push({
                source_title: 'Loading',
                display_title: 'Loading trajectories...',
                isLoading: true,
                isPlaceholder: true
            });
        }
    } catch (error) {
        console.error('Error processing pseudotime data:', error);
        // Continue with empty data rather than breaking the component
    }

    // Handle confirmation button click
    const handleAnalyzeGeneExpression = async () => {
        if (selectedGlyphs.size === 0) {
            console.warn('No glyphs selected');
            return;
        }

        if (selectedGenes.length === 0) {
            console.warn('No genes selected');
            return;
        }

        setIsAnalyzing(true);

        try {
            const analysisRequests = [];

            // Extract clean gene names from the selected gene values (format: sampleId_geneName)
            const geneNames = selectedGenes.map(geneValue => {
                // Use label from HVG list when available
                const geneInfo = allHighVariableGenes.find(g => g.value === geneValue);
                if (geneInfo) return geneInfo.label;
                // Fallback: value pattern is `${sampleId}_${gene}`; sampleId may contain underscores, so take substring after last underscore
                if (typeof geneValue === 'string' && geneValue.includes('_')) {
                    const lastUnderscore = geneValue.lastIndexOf('_');
                    return geneValue.slice(lastUnderscore + 1);
                }
                return geneValue;
            });

            // Create analysis requests for each selected glyph
            Array.from(selectedGlyphs).forEach(glyphIndex => {
                const trajectoryData = allPseudotimeData[glyphIndex];
                if (trajectoryData && !trajectoryData.isPlaceholder && trajectoryData.mergedTrajectories) {
                    // Use the related sample IDs directly - typically there should be one main sample
                    // For pseudotime analysis, we should use the same sample that generated the trajectory
                    const sampleId = relatedSampleIds.length > 0 ? relatedSampleIds[0] : 'unknown';

                    // The trajectory ID should match the glyph index or trajectory data structure
                    const trajectoryId = glyphIndex;

                    // For merged trajectories, we need to handle multiple paths
                    trajectoryData.mergedTrajectories.forEach((singleTrajectory, trajIndex) => {
                        analysisRequests.push({
                            sample_id: sampleId,
                            genes: geneNames,
                            adata_umap_title: trajectoryData.source_title,
                            trajectory_id: `${trajectoryId}_${trajIndex}`,
                            trajectory_path: singleTrajectory.path
                        });
                    });
                }
            });

            // Make API calls to get_trajectory_gene_expression for each request
            const analysisResults = [];

            for (const request of analysisRequests) {
                try {
                    const response = await fetch("/api/get_trajectory_gene_expression", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            sample_id: request.sample_id,
                            adata_umap_title: request.adata_umap_title,
                            gene_names: request.genes,
                            trajectory_path: request.trajectory_path
                        }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Validate and sanitize the response data to prevent memory issues
                        if (data && typeof data === 'object') {
                            analysisResults.push({
                                ...request,
                                gene_expression_data: data
                            });
                        } else {
                            console.warn(`Invalid gene expression data format for sample ${request.sample_id}`);
                        }
                    } else {
                        const errorText = await response.text();
                        console.error(`Failed to get gene expression data for sample ${request.sample_id}: ${response.status} ${errorText}`);
                    }
                } catch (error) {
                    console.error(`Error fetching gene expression data for sample ${request.sample_id}:`, error);
                }
            }

            // Only update state if we have successful results
            if (analysisResults.length > 0) {
                // Append new results to existing data, replacing any data for the same glyphs
                setGeneExpressionData(prevData => {
                    // Get trajectory IDs that are being updated
                    const updatedTrajectoryIds = new Set(analysisResults.map(result => result.trajectory_id));
                    
                    // Keep existing data that doesn't conflict with new results
                    const preservedData = prevData.filter(existingData => 
                        !updatedTrajectoryIds.has(existingData.trajectory_id)
                    );
                    
                    // Combine preserved data with new results
                    return [...preservedData, ...analysisResults];
                });
            } else {
                console.warn('No gene expression data was successfully retrieved');
            }
        } catch (error) {
            console.error('Error during gene expression analysis:', error);
            // Don't let errors break the entire component - just log them and continue
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Check if there's any global loading happening and no data exists yet
    const anyLoading = Object.values(pseudotimeLoadingStates).some(loading => loading);
    const hasNoData = Object.keys(pseudotimeDataSets).length === 0;

    // If there's a component error, show error state
    if (componentError) {
        return (
            <div style={{
                textAlign: 'center',
                marginTop: '15%',
                color: '#ff4d4f',
                padding: '20px'
            }}>
                <div style={{ fontSize: '16px', marginBottom: '10px' }}>Component Error</div>
                <div style={{ fontSize: '12px', marginBottom: '10px' }}>{componentError.message}</div>
                <Button
                    size="small"
                    onClick={() => setComponentError(null)}
                    type="primary"
                >
                    Retry
                </Button>
            </div>
        );
    }

    // If allPseudotimeData is not an array or is empty, show loading or empty state
    if (anyLoading && hasNoData) {
        return (
            <div style={{ textAlign: 'center', marginTop: '15%' }}>
                <Spin size="large" />
                <div style={{ textAlign: 'center', marginTop: '8px', color: '#666', fontSize: '12px' }}>
                    {(() => {
                        const loadingNames = (umapDataSets || [])
                            .filter(ds => pseudotimeLoadingStates?.[ds.adata_umap_title])
                            .map(ds => ds.title || ds.adata_umap_title);

                        if (loadingNames.length === 0) return 'Generating pseudotime...';
                        if (loadingNames.length === 1) return `Generating ${loadingNames[0]}...`;
                        return `Generating ${loadingNames.join(', ')}...`;
                    })()}
                </div>
            </div>
        );
    }

    if (!allPseudotimeData || allPseudotimeData.length === 0) {
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
            }}>
                <Empty
                    description="No pseudotime data available"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            </div>
        );
    }

    return (
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
        }}>
            {/* Gene Selection Dropdown and Confirmation Button */}
            <div style={{
                top: '5px',
                right: '10px',
                zIndex: 999,
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '5px'
            }}>
                <Select
                    className="pseudotime-gene-select"
                    placeholder="Select Genes"
                    value={selectedGenes}
                    onChange={setSelectedGenes}
                    style={{ width: '220px' }}
                    size="small"
                    options={displayOptions}
                    mode="multiple"
                    showSearch
                    filterOption={false}
                    onSearch={handleGeneSearch}
                    onOpenChange={(open) => {
                        if (!open) {
                            // reset to HVGs when closing dropdown
                            setSearchQuery('');
                            setDisplayOptions(hvgGroupedOptions);
                        }
                    }}
                    notFoundContent={searchLoading ? <Spin size="small" /> : null}
                    maxTagCount="responsive"
                    allowClear
                />
                <Button
                    onClick={handleAnalyzeGeneExpression}
                    disabled={selectedGlyphs.size === 0 || selectedGenes.length === 0 || isAnalyzing}
                    loading={isAnalyzing}
                    type="primary"
                    size="small"
                >
                    Analyze
                </Button>
            </div>

            {(() => {
                const indexToKey = (i) => (allPseudotimeData[i]?.source_title) || `${i}`;
                const visibleIndices = allPseudotimeData.map((_, i) => i).filter(i => !hiddenGlyphs.has(indexToKey(i)));
                const visibleCount = visibleIndices.length;
                return (
                    <div style={{
                        width: '100%',
                        height: `calc(100% - 35px)`,
                        display: 'grid',
                        gridTemplateColumns: visibleCount === 1 ? 'minmax(0, 1fr)' :
                            'repeat(2, minmax(0, 1fr))',
                        gridAutoRows: visibleCount <= 2 ? '1fr' : '100%',
                        gap: '5px',
                        overflow: visibleCount <= 2 ? 'hidden' : 'auto',
                        boxSizing: 'border-box'
                    }}>
                {visibleIndices.map((index) => {
                    const trajectoryData = allPseudotimeData[index];
                    const glyphKey = indexToKey(index);
                    return (
                        <div
                            key={index}
                            style={{
                                width: '100%',
                                height: '99%',
                                textAlign: 'center',
                                border: '1px solid #ddd',
                                borderRadius: '8px',
                                backgroundColor: '#f9f9f9',
                                position: 'relative',
                                overflow: 'hidden',
                                boxSizing: 'border-box'
                            }}
                        >
                            {!trajectoryData.isPlaceholder && (
                                <div style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    zIndex: 900,
                                }}>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<CloseOutlined />}
                                        onClick={() => handleCloseGlyph(glyphKey)}
                                        aria-label="Close glyph"
                                    />
                                </div>
                            )}
                            {trajectoryData.isPlaceholder ? (
                                <div style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px dashed #ccc',
                                    borderRadius: '8px',
                                    color: '#666',
                                    fontSize: '12px',
                                    backgroundColor: '#fafafa',
                                    boxSizing: 'border-box'
                                }}>
                                    <Spin size="large" style={{ marginBottom: '10px' }} />
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                                            Generating Pseudotime
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#999' }}>
                                            {trajectoryData.display_title}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                (() => {
                                    try {
                                        // For merged trajectories, collect gene expression data from all related trajectories
                                        let geneDataForGlyph = null;

                                        if (trajectoryData.mergedTrajectories && trajectoryData.mergedTrajectories.length > 0) {
                                            // Collect all gene expression data for trajectories that start with this glyph index
                                            const relatedGeneData = geneExpressionData.filter(data =>
                                                data.trajectory_id && data.trajectory_id.toString().startsWith(`${index}_`)
                                            );

                                            if (relatedGeneData.length > 0) {
                                                // Pass all related gene data so the glyph can select the appropriate one
                                                geneDataForGlyph = relatedGeneData;
                                            }
                                        } else {
                                            // Single trajectory - find by exact match
                                            const singleGeneData = geneExpressionData.find(data =>
                                                data.trajectory_id === index || data.trajectory_id === index.toString()
                                            );
                                            geneDataForGlyph = singleGeneData ? [singleGeneData] : null;
                                        }

                                        // Get cluster color mapping for this trajectory data
                                        // Try different key formats to find the correct mapping
                                        let clusterColors = null;
                                        if (clusterColorMappings) {
                                            // Try the source_title first
                                            clusterColors = clusterColorMappings[trajectoryData.source_title]?.clusters;

                                            // If not found, try the adata_umap_title
                                            if (!clusterColors && adata_umap_title) {
                                                clusterColors = clusterColorMappings[adata_umap_title]?.clusters;
                                            }

                                            // If still not found, try with sample_id prefix
                                            if (!clusterColors && trajectoryData.sampleId) {
                                                const keyWithSample = `${trajectoryData.sampleId}_${trajectoryData.source_title || adata_umap_title}`;
                                                clusterColors = clusterColorMappings[keyWithSample]?.clusters;
                                            }
                                        }

                                        // Find the corresponding UMAP dataset to get area color information
                                        // Extract the original adata_umap_title from cluster-specific cache keys
                                        const originalAdataTitle = trajectoryData.originalAdataTitle || 
                                            (trajectoryData.source_title && trajectoryData.source_title.includes('_cluster_') 
                                                ? trajectoryData.source_title.replace(/_cluster_\d+$/, '') 
                                                : trajectoryData.source_title);
                                        
                                        const correspondingUmapDataset = umapDataSets?.find(dataset => 
                                            dataset.adata_umap_title === originalAdataTitle
                                        );

                                        return (
                                            <PseudotimeGlyph
                                                adata_umap_title={trajectoryData.display_title}
                                                pseudotimeData={trajectoryData.fullPseudotimeData || trajectoryData.mergedTrajectories || [trajectoryData]}
                                                pseudotimeLoading={trajectoryData.isLoading}
                                                isSelected={selectedGlyphs.has(index)}
                                                onSelectionChange={(isSelected) => handleGlyphSelection(index, isSelected)}
                                                geneExpressionData={geneDataForGlyph}
                                                clusterColors={clusterColors}
                                                hoveredTrajectory={hoveredTrajectory}
                                                setHoveredTrajectory={setHoveredTrajectory}
                                                trajectoryIndex={index}
                                                source_title={trajectoryData.source_title || adata_umap_title}
                                                umapParameters={trajectoryData.umapParameters}
                                                areaColor={correspondingUmapDataset?.areaColor}
                                                areaName={correspondingUmapDataset?.areaName}
                                            />
                                        );
                                    } catch (error) {
                                        console.error(`Error rendering glyph ${index}:`, error);
                                        return (
                                            <div style={{
                                                width: '100%',
                                                height: '100%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: '2px solid #ff4d4f',
                                                borderRadius: '8px',
                                                color: '#ff4d4f',
                                                fontSize: '12px'
                                            }}>
                                                Error rendering glyph
                                            </div>
                                        );
                                    }
                                })()
                            )}
                        </div>
                    );
                })}
                    </div>
                );
            })()}
        </div>
    );
};