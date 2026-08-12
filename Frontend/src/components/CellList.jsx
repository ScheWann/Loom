import React from 'react';
import { Checkbox, ColorPicker } from "antd";
import { COLOR_PALETTE } from "./Utils";

export const CellSettings = ({
    cellTypesData,
    selectedCellTypes,
    setSelectedCellTypes,
    cellTypeColors,
    setCellTypeColors
}) => {
    // Function to get a default color for a cell type
    const getDefaultColor = (cellType, index) => {
        return COLOR_PALETTE[index % COLOR_PALETTE.length];
    };

    // Function to toggle cell type selection
    const toggleCellTypeSelection = (cellType) => {
        if (selectedCellTypes.includes(cellType)) {
            setSelectedCellTypes(selectedCellTypes.filter(ct => ct !== cellType));
        } else {
            setSelectedCellTypes([...selectedCellTypes, cellType]);
        }
    };

    // Function to update cell type color
    const updateCellTypeColor = (cellType, color) => {
        setCellTypeColors(prev => ({
            ...prev,
            [cellType]: color
        }));
    };

    return (
        <div style={{ maxHeight: 400 }}>
            {/* Cell types list */}
            <div style={{ marginBottom: 8 }}>
                {!cellTypesData || cellTypesData.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--app-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                        No cell types available. Please select and confirm samples first.
                    </div>
                ) : (
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                        {cellTypesData.map(({ name, count }, index) => (
                            <div key={name} style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '6px 0',
                                borderBottom: '1px solid var(--app-border)',
                            }}>
                                <Checkbox
                                    checked={selectedCellTypes.includes(name)}
                                    onChange={() => toggleCellTypeSelection(name)}
                                    style={{ marginRight: 8 }}
                                />
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    width: '100%',
                                    gap: '8px'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <span style={{
                                            fontSize: 12,
                                            color: selectedCellTypes.includes(name) ? 'var(--app-text)' : 'var(--app-text-muted)',
                                            fontWeight: selectedCellTypes.includes(name) ? '500' : 'normal'
                                        }}>
                                            {name}
                                        </span>
                                        <span style={{
                                            fontSize: 10,
                                            color: 'var(--app-text-muted)',
                                            marginLeft: '8px',
                                            fontStyle: 'italic'
                                        }}>
                                            ({count.toLocaleString()} cells)
                                        </span>
                                    </div>
                                    <ColorPicker
                                        value={cellTypeColors[name] || getDefaultColor(name, index)}
                                        onChange={(color, hex) => updateCellTypeColor(name, hex)}
                                        size="small"
                                        showText={false}
                                        style={{
                                            width: 24,
                                            height: 24,
                                            opacity: selectedCellTypes.includes(name) ? 1 : 0.5
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
