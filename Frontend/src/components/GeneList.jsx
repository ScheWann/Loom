import React, { useState, useEffect, useMemo } from 'react';
import { Button, Checkbox, AutoComplete, ColorPicker } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { COLOR_PALETTE, debounce } from './Utils';

export const GeneSettings = ({ sampleId, availableGenes, setAvailableGenes, selectedGenes, setSelectedGenes, geneColorMap, setGeneColorMap, onKosaraData, onKosaraLoadingStart }) => {
    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    // Function to handle adding a gene to the visibility list
    const onVisibilityGeneChange = (gene) => {
        if (!availableGenes.includes(gene)) {
            setAvailableGenes([...availableGenes, gene]);
            setSelectedGenes([...selectedGenes, gene]);
        }
    };

    // Function to toggle gene selection
    const toggleGeneSelection = (gene) => {
        if (selectedGenes.includes(gene)) {
            setSelectedGenes(selectedGenes.filter(g => g !== gene));
        } else {
            setSelectedGenes([...selectedGenes, gene]);
        }
    };

    // Function to clear all gene selections
    const cleanGeneSelection = () => {
        setAvailableGenes([]);
        setSelectedGenes([]);
    };

    // Function to remove a gene from the visibility list
    const removeGene = (geneToRemove) => {
        setAvailableGenes(availableGenes.filter(gene => gene !== geneToRemove));
        setSelectedGenes(selectedGenes.filter(gene => gene !== geneToRemove));
    };

    // Function to confirm gene selection and fetch Kosara data
    const confirmGeneSelection = async (sampleId) => {
        try {
            if (onKosaraLoadingStart) {
                onKosaraLoadingStart(sampleId);
            }

            // Check if only one gene is selected for single gene visualization
            if (selectedGenes.length === 1) {
                const response = await fetch('/api/get_single_gene_expression', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sample_ids: [sampleId],
                        gene_name: selectedGenes[0]
                    })
                });
                if (!response.ok) {
                    console.error('Failed to fetch single gene expression data:', response.status, response.statusText);
                    if (onKosaraData) {
                        onKosaraData(sampleId, []);
                    }
                    return;
                }
                const data = await response.json();
                if (onKosaraData && data && data[sampleId]) {
                    // Mark this as single gene data for proper handling
                    onKosaraData(sampleId, data[sampleId], 'single_gene', selectedGenes[0]);
                } else if (onKosaraData) {
                    onKosaraData(sampleId, []);
                }
            } else {
                // Multiple genes selected, use Kosara visualization
                const response = await fetch('/api/get_kosara_data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sample_ids: [sampleId],
                        gene_list: selectedGenes
                    })
                });
                if (!response.ok) {
                    console.error('Failed to fetch Kosara data:', response.status, response.statusText);
                    if (onKosaraData) {
                        onKosaraData(sampleId, []);
                    }
                    return;
                }
                const data = await response.json();
                if (onKosaraData && data && data[sampleId]) {
                    onKosaraData(sampleId, data[sampleId], 'kosara');
                } else if (onKosaraData) {
                    onKosaraData(sampleId, []);
                }
            }
        } catch (err) {
            console.error('Error fetching gene data:', err);
            if (onKosaraData) {
                onKosaraData(sampleId, []);
            }
        }
    };

    // Debounced search function to avoid too many API calls
    const searchGenes = useMemo(
        () =>
            debounce(async (query) => {
                if (!query || query.length < 2) {
                    setSearchResults([]);
                    setIsSearching(false);
                    return;
                }

                setIsSearching(true);
                try {
                    const response = await fetch('/api/get_gene_name_search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sample_id: sampleId,
                            gene_name: query
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Filter out already added genes and limit results
                        const filteredResults = data
                            .filter(gene => !availableGenes.includes(gene))
                            .slice(0, 10);

                        setSearchResults(filteredResults);
                    } else {
                        console.error('Gene search failed:', response.status, response.statusText);
                        setSearchResults([]);
                    }
                } catch (error) {
                    console.error('Gene search error:', error);
                    setSearchResults([]);
                }
                setIsSearching(false);
            }, 300),
        [sampleId, availableGenes]
    );

    const handleGeneSelect = (gene) => {
        onVisibilityGeneChange(gene);
        setSearchText('');
    };

    // Effect to trigger search when searchText changes
    useEffect(() => {
        searchGenes(searchText);
    }, [searchText, searchGenes]);

    // Initialize default colors for genes using COLOR_PALETTE
    useEffect(() => {
        setGeneColorMap(prev => {
            const next = { ...prev };
            // Add defaults for new genes
            availableGenes.forEach((gene, idx) => {
                if (!next[gene]) {
                    const position = selectedGenes.includes(gene)
                        ? selectedGenes.indexOf(gene)
                        : idx;
                    next[gene] = COLOR_PALETTE[position % COLOR_PALETTE.length];
                }
            });
            // Remove entries for removed genes
            Object.keys(next).forEach(g => {
                if (!availableGenes.includes(g)) delete next[g];
            });
            return next;
        });
    }, [availableGenes, selectedGenes]);



    return (
        <div style={{ maxHeight: 400 }}>
            <AutoComplete
                size="small"
                placeholder="Search and add genes..."
                value={searchText}
                options={searchResults.map(gene => ({ value: gene, label: gene }))}
                onSearch={setSearchText}
                onSelect={handleGeneSelect}
                loading={isSearching}
                style={{ width: '100%', marginBottom: 8 }}
                notFoundContent={searchText.length >= 2 ? (isSearching ? 'Searching...' : 'No genes found') : null}
                showSearch
            />

            {/* Selected genes list */}
            <div style={{ marginBottom: 8 }}>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {availableGenes.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>
                            No genes added. Use search above to add genes.
                        </div>
                    ) : (
                        availableGenes.map((gene) => (
                            <div key={gene} style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '4px 0',
                                borderBottom: '1px solid #f0f0f0',
                            }}>
                                <Checkbox
                                    checked={selectedGenes.includes(gene)}
                                    onChange={() => toggleGeneSelection(gene)}
                                    style={{ marginRight: 8 }}
                                />
                                <ColorPicker
                                    size="small"
                                    value={geneColorMap[gene]}
                                    onChange={(color) => {
                                        const hex = color.toHexString();
                                        setGeneColorMap(prev => ({ ...prev, [gene]: hex }));
                                    }}
                                    style={{ marginRight: 8 }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                    <span style={{ fontSize: 12, color: selectedGenes.includes(gene) ? '#000' : '#999' }}>
                                        {gene}
                                    </span>
                                    <Button type="text" size="small" onClick={() => removeGene(gene)} style={{ padding: '0 4px', fontSize: 10, color: '#333333' }} icon={<CloseOutlined />} />
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 5 }}>
                <Button size='small' style={{ width: '50%' }} onClick={cleanGeneSelection}>Clear</Button>
                <Button size='small' style={{ width: '50%' }} onClick={() => confirmGeneSelection(sampleId)}>Confirm</Button>
            </div>
        </div>
    );
};