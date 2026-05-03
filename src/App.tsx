import React, { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set up the worker for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { 
  Square, 
  MousePointer2, 
  Ruler, 
  Scaling, 
  Plus, 
  FileUp, 
  Zap, 
  ClipboardList, 
  Calculator,
  Layers,
  Settings,
  HelpCircle,
  Download,
  X,
  Target
} from 'lucide-react';
import { Canvas } from './components/Canvas';
import { Tool, Wall, Scale, Measurement, Dimension } from './types';
import { detectWallsFromImage } from './services/aiService';
import { cn, formatDimension } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';

export default function App() {
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [walls, setWalls] = useState<Wall[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string | undefined>();

  // keyboard listener for deletion
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWallId) {
        // Prevent deletion if user is typing in an input
        if (document.activeElement?.tagName === 'INPUT') return;
        
        setWalls(prev => prev.filter(w => w.id !== selectedWallId));
        setSelectedWallId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWallId]);
  const [scale, setScale] = useState<Scale | null>(null);
  const [wallThickness, setWallThickness] = useState(0.20); // Default 0.20m or 0.65ft approx
  const [wallHeight, setWallHeight] = useState(2.75); // Default 2.75m or 9ft approx

  const [lastThickProbe, setLastThickProbe] = useState<number | null>(null);

  // Automatically switch to scale tool when blueprint is loaded but scale is undefined
  React.useEffect(() => {
    if (bgImageUrl && !scale) {
      setActiveTool('scale');
    }
  }, [bgImageUrl, scale]);

  const handleProbeComplete = (pxLength: number) => {
    if (scale) {
       const realThick = pxLength / ((scale.ratioX + scale.ratioY) / 2);
       setLastThickProbe(realThick);
       
       if (selectedWallId) {
         setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, thickness: realThick } : w));
       } else {
         setWallThickness(+realThick.toFixed(3));
       }
    }
  };
  const [scaleUnit, setScaleUnit] = useState<'m' | 'ft'>('m');
  const prevUnitRef = React.useRef<'m' | 'ft'>(scaleUnit);

  // Handle unit conversion for all measurements when scaleUnit changes
  React.useEffect(() => {
    if (prevUnitRef.current === scaleUnit) return;

    const toFeet = 3.28084;
    const toMeters = 1 / toFeet;
    const factor = scaleUnit === 'ft' ? toFeet : toMeters;

    setWallThickness(prev => +(prev * factor).toFixed(3));
    setWallHeight(prev => +(prev * factor).toFixed(2));
    setWalls(prev => prev.map(w => ({
      ...w,
      thickness: w.thickness * factor,
      height: w.height * factor
    })));
    
    if (scale) {
      setScale(prev => prev ? {
        ...prev,
        ratioX: prev.ratioX / factor,
        ratioY: prev.ratioY / factor,
        unit: scaleUnit
      } : null);
    }

    if (lastThickProbe) {
      setLastThickProbe(prev => prev ? prev * factor : null);
    }

    prevUnitRef.current = scaleUnit;
  }, [scaleUnit, scale, lastThickProbe]);

  const [showScaleModal, setShowScaleModal] = useState(false);
  const [pendingPxLength, setPendingPxLength] = useState(0);
  const [realLengthInput, setRealLengthInput] = useState('1');

  const [isProcessing, setIsProcessing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const handleAiDetect = async () => {
    if (!bgImageUrl) {
      alert("Please upload a blueprint first.");
      return;
    }

    setIsAiProcessing(true);
    try {
      // 1. Get base64 data and image dimensions
      let base64Data = "";
      let mimeType = "image/png";

      if (bgImageUrl.startsWith('data:')) {
        const parts = bgImageUrl.split(',');
        base64Data = parts[1];
        mimeType = parts[0].split(':')[1].split(';')[0];
      } else {
        const response = await fetch(bgImageUrl);
        const blob = await response.blob();
        mimeType = blob.type;
        base64Data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.readAsDataURL(blob);
        });
      }

      // 2. Get image dimensions to scale coordinates
      const img = new Image();
      img.src = bgImageUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      const { width, height } = img;

      // 3. Call AI service
      const detected = await detectWallsFromImage(base64Data, mimeType);

      // 4. Convert normalized coordinates back to pixels and update state
      const newWalls: Wall[] = detected.map(d => {
        const pxX1 = (d.x1 / 1000) * width;
        const pxY1 = (d.y1 / 1000) * height;
        const pxX2 = (d.x2 / 1000) * width;
        const pxY2 = (d.y2 / 1000) * height;

        // Convert normalized thickness to pixel thickness
        const pxThickness = (d.thickness / 1000) * ((width + height) / 2);

        // Convert pixel thickness to real units using scale ratio
        const avgRatio = scale ? ((scale.ratioX + scale.ratioY) / 2) : 1;
        let finalThickness = scale 
          ? Math.max(0.05, pxThickness / avgRatio) 
          : (scaleUnit === 'ft' 
              ? (d.thickness > 10 ? 0.75 : 0.425) // Fallback for Feet: 9" or 4.5"
              : (d.thickness > 10 ? 0.23 : 0.115) // Fallback for Meters: 23cm or 11.5cm
            ); 

        // Snap to standard thicknesses if close (9" or 4.5")
        const snapThreshold = scaleUnit === 'ft' ? 0.115 : 0.035; // ~11cm tolerance for ft or 3.5cm for metric
        const standards = scaleUnit === 'ft' ? [0.425, 0.75] : [0.115, 0.23];
        
        for (const std of standards) {
          if (Math.abs(finalThickness - std) < snapThreshold) {
            finalThickness = std;
            break;
          }
        }

        return {
          id: Math.random().toString(36).substr(2, 9),
          points: [pxX1, pxY1, pxX2, pxY2],
          thickness: finalThickness,
          height: wallHeight,
          color: '#1e293b'
        };
      });

      setWalls(prev => [...prev, ...newWalls]);
    } catch (error) {
      console.error("AI Detect failed:", error);
      alert("AI Detection failed. Please try again.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      setIsProcessing(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        
        const scale = 2; // Higher quality
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not get canvas context');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }).promise;
        
        const dataUrl = canvas.toDataURL('image/png');
        setBgImageUrl(dataUrl);
      } catch (error) {
        console.error('Error processing PDF:', error);
        alert('Failed to process PDF. Please try an image file instead.');
      } finally {
        setIsProcessing(false);
      }
    } else {
      const url = URL.createObjectURL(file);
      setBgImageUrl(url);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    noClick: !!bgImageUrl || isProcessing,
    accept: { 
      'image/*': [],
      'application/pdf': ['.pdf']
    } 
  });

  const [scaleAxis, setScaleAxis] = useState<'both' | 'x' | 'y'>('both');

  const handleScaleDefine = (px: number) => {
    setPendingPxLength(px);
    setShowScaleModal(true);
  };

  const confirmScale = () => {
    const realVal = parseFloat(realLengthInput);
    const newRatio = pendingPxLength / realVal;

    setScale(prev => {
      const unit = scaleUnit;
      if (scaleAxis === 'both') {
        return { ratioX: newRatio, ratioY: newRatio, unit };
      } else if (scaleAxis === 'x') {
        return { ratioX: newRatio, ratioY: prev?.ratioY || newRatio, unit };
      } else {
        return { ratioX: prev?.ratioX || newRatio, ratioY: newRatio, unit };
      }
    });
    setShowScaleModal(false);
    setActiveTool('select');
  };

  const totalLength = walls.reduce((acc, wall) => {
    const dx = wall.points[2] - wall.points[0];
    const dy = wall.points[3] - wall.points[1];
    
    if (!scale) return 0;
    
    const realX = Math.abs(dx) / (scale.ratioX || 1);
    const realY = Math.abs(dy) / (scale.ratioY || 1);
    const len = Math.sqrt(realX * realX + realY * realY);
    
    return acc + len;
  }, 0);

  const totalArea = walls.reduce((acc, wall) => {
    const dx = wall.points[2] - wall.points[0];
    const dy = wall.points[3] - wall.points[1];
    const realX = Math.abs(dx) / (scale?.ratioX || 1);
    const realY = Math.abs(dy) / (scale?.ratioY || 1);
    const length = Math.sqrt(realX * realX + realY * realY);
    return acc + (length * wall.height * 2); // Both faces
  }, 0);

  const totalVolume = walls.reduce((acc, wall) => {
    const dx = wall.points[2] - wall.points[0];
    const dy = wall.points[3] - wall.points[1];
    const realX = Math.abs(dx) / (scale?.ratioX || 1);
    const realY = Math.abs(dy) / (scale?.ratioY || 1);
    const length = Math.sqrt(realX * realX + realY * realY);
    return acc + (length * wall.height * wall.thickness);
  }, 0);

  const unitLabel = scale?.unit || scaleUnit;
  const areaUnitLabel = unitLabel === 'm' ? 'm²' : 'sq ft';
  const volumeUnitLabel = unitLabel === 'm' ? 'm³' : 'cu ft';

  return (
    <div className="flex h-screen w-full bg-[#F8FAFC] text-slate-800 font-sans overflow-hidden">
      {/* Sidebar - Tools */}
      <aside className="w-16 flex flex-col items-center py-4 border-r border-slate-200 bg-white z-20">
        <div className="mb-8 p-2 bg-blue-600 rounded-lg shadow-sm shadow-blue-200">
          <Zap className="w-6 h-6 text-white" />
        </div>
        
          <div className="flex flex-col gap-4">
            <ToolButton 
              active={activeTool === 'select'} 
              onClick={() => setActiveTool('select')}
              icon={<MousePointer2 size={20} />}
              label="Select"
            />
            <ToolButton 
              active={activeTool === 'scale'} 
              onClick={() => setActiveTool('scale')}
              icon={<Scaling size={20} />}
              label="Scale"
            />
            <ToolButton 
              active={activeTool === 'wall'} 
              onClick={() => setActiveTool('wall')}
              disabled={!scale}
              icon={<Square size={20} />}
              label={scale ? "Wall" : "Define Scale First"}
            />
            <ToolButton 
              active={activeTool === 'dimension'} 
              onClick={() => setActiveTool('dimension')}
              disabled={!scale}
              icon={<Ruler size={20} />}
              label={scale ? "Dimensions" : "Define Scale First"}
            />
            <ToolButton 
              active={activeTool === 'probe'} 
              onClick={() => setActiveTool('probe')}
              disabled={!scale}
              icon={<Target size={20} />}
              label={scale ? "Thickness Probe" : "Define Scale First"}
            />
          </div>

        <div className="mt-auto flex flex-col gap-4">
          <ToolButton icon={<Settings size={20} />} label="Settings" />
          <ToolButton icon={<HelpCircle size={20} />} label="Help" />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Top Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-slate-200 bg-white/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold tracking-tight text-slate-800">STRUCTURA AI <span className="text-[10px] font-normal text-slate-400 ml-2">v0.1.0</span></h1>
            <div className="h-4 w-px bg-slate-200 mx-2" />
            <span className="text-xs text-slate-400 font-medium">Residence_A_01</span>
          </div>

          <div className="flex items-center gap-2">
            {!bgImageUrl && (
              <button 
                {...getRootProps()}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-md text-xs font-medium border border-slate-200 transition-colors text-slate-600"
              >
                <input {...getInputProps()} />
                <FileUp size={14} />
                Upload Blueprint
              </button>
            )}
            <button 
              onClick={handleAiDetect}
              disabled={!bgImageUrl || isAiProcessing}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white font-medium rounded-md text-xs hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Zap size={14} className={isAiProcessing ? "animate-pulse" : ""} />
              {isAiProcessing ? 'Analyzing...' : 'AI Detect'}
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white font-medium rounded-md text-xs hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200">
              <Download size={14} />
              Export
            </button>
          </div>
        </header>

        {/* Canvas Area */}
        <div className="flex-1 relative overflow-hidden bg-slate-50" {...(!bgImageUrl ? getRootProps() : {})}>
          {(isProcessing || isAiProcessing) && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center z-[60]">
              <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-slate-600 font-bold animate-pulse">
                {isProcessing ? 'OPTIMIZING BLUEPRINT...' : 'AI DETECTING WALLS...'}
              </p>
            </div>
          )}

          {!bgImageUrl && !isDragActive && !isProcessing && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="text-center p-12 border-2 border-dashed border-slate-200 rounded-2xl bg-white shadow-sm">
                <FileUp className="w-10 h-10 mx-auto mb-4 text-slate-300" />
                <p className="text-slate-500 font-medium text-sm">Drop blueprint here to start</p>
                <p className="text-[10px] text-slate-400 mt-2">PROJECT: {scale ? `X 1:${Math.round(scale.ratioX)} | Y 1:${Math.round(scale.ratioY)}` : 'UNKNOWN_SCALE'}</p>
              </div>
            </div>
          )}
          
          {isDragActive && (
            <div className="absolute inset-0 bg-blue-50/50 border-2 border-blue-600 border-dashed flex items-center justify-center z-50">
              <p className="text-blue-600 font-bold">DROP TO START ANALYZING</p>
            </div>
          )}

            <Canvas 
              tool={activeTool}
              bgImageUrl={bgImageUrl}
              walls={walls}
              setWalls={setWalls}
              dimensions={dimensions}
              setDimensions={setDimensions}
              scale={scale}
              onScaleDefine={handleScaleDefine}
              onProbeDefine={handleProbeComplete}
              currentThickness={wallThickness}
              currentHeight={wallHeight}
              selectedWallId={selectedWallId}
              onSelectWall={setSelectedWallId}
            />
        </div>

        {/* Bottom Status Bar */}
        <footer className="h-8 flex items-center justify-between px-4 border-t border-slate-200 bg-white text-[10px] text-slate-400 font-medium">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 uppercase tracking-wider"><Layers size={10} /> Structural Layer</span>
            <span className="text-slate-200">|</span>
            <span className="flex items-center gap-1 uppercase tracking-wider"><Scaling size={10} /> {scale ? `Scale X:1:${Math.round(scale.ratioX)} Y:1:${Math.round(scale.ratioY)}` : 'Define Scale First'}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-blue-600 font-bold uppercase tracking-widest">Tool: {activeTool}</span>
            <span className="text-green-500 font-bold">● AI Active</span>
          </div>
        </footer>
      </main>

      {/* Right Sidebar - Estimates & Details */}
      <aside className="w-72 border-l border-slate-200 bg-white flex flex-col z-20">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
            <Settings size={14} className="text-slate-300" /> Tool Settings
          </h3>
          
          <div className="space-y-4">
            {activeTool === 'wall' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Quick Presets</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setWallThickness(scaleUnit === 'ft' ? 0.425 : 0.115)}
                      className={cn(
                        "flex-1 py-1.5 text-[9px] font-bold uppercase rounded-md border transition-all",
                        (scaleUnit === 'ft' ? wallThickness === 0.425 : wallThickness === 0.115) 
                          ? "bg-slate-800 border-slate-900 text-white shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      4.5" Wall
                    </button>
                    <button 
                      onClick={() => setWallThickness(scaleUnit === 'ft' ? 0.75 : 0.23)}
                      className={cn(
                        "flex-1 py-1.5 text-[9px] font-bold uppercase rounded-md border transition-all",
                        (scaleUnit === 'ft' ? wallThickness === 0.75 : wallThickness === 0.23) 
                          ? "bg-slate-800 border-slate-900 text-white shadow-sm" 
                          : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      9" Wall
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Wall Thickness ({unitLabel})</label>
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      step="0.01"
                      min="0.01"
                      value={wallThickness}
                      onChange={(e) => setWallThickness(parseFloat(e.target.value) || 0)}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-600 focus:outline-none transition-all"
                    />
                    <div className="flex flex-col gap-1">
                      <button 
                        onClick={() => setWallThickness(prev => +(prev + 0.01).toFixed(3))}
                        className="px-2 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold"
                      >
                        +
                      </button>
                      <button 
                        onClick={() => setWallThickness(prev => Math.max(0.01, +(prev - 0.01).toFixed(3)))}
                        className="px-2 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold"
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Wall Height ({unitLabel})</label>
                  <div className="flex gap-2">
                    <input 
                      type="number" 
                      step="0.1"
                      min="0.1"
                      value={wallHeight}
                      onChange={(e) => setWallHeight(parseFloat(e.target.value) || 0)}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-600 focus:outline-none transition-all"
                    />
                    <div className="flex flex-col gap-1">
                      <button 
                        onClick={() => setWallHeight(prev => +(prev + 0.1).toFixed(2))}
                        className="px-2 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold"
                      >
                        +
                      </button>
                      <button 
                        onClick={() => setWallHeight(prev => Math.max(0.1, +(prev - 0.1).toFixed(2)))}
                        className="px-2 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold"
                      >
                        -
                      </button>
                    </div>
                  </div>
                </div>

                {walls.length > 0 && (
                  <div className="space-y-4">
                    {/* Selected Wall Properties Section */}
                    {selectedWallId && (
                      <div className="space-y-2 pb-4 border-b border-slate-100">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-blue-600 uppercase tracking-tighter">Selected Wall Properties</label>
                          <button 
                            onClick={() => setSelectedWallId(null)}
                            className="text-[9px] font-bold text-slate-400 hover:text-slate-600 uppercase"
                          >
                            Deselect
                          </button>
                        </div>
                        
                        {(() => {
                          const wall = walls.find(w => w.id === selectedWallId);
                          if (!wall) return null;
                          
                          const dx = wall.points[2] - wall.points[0];
                          const dy = wall.points[3] - wall.points[1];
                          const realX = Math.abs(dx) / (scale?.ratioX || 1);
                          const realY = Math.abs(dy) / (scale?.ratioY || 1);
                          const currentLength = Math.sqrt(realX * realX + realY * realY);

                          return (
                            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-3 shadow-sm">
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <div className="flex justify-between">
                                    <label className="text-[9px] font-bold text-blue-500 uppercase">Length ({scaleUnit})</label>
                                    <span className="text-[9px] font-mono text-blue-400">Fixed Start Point</span>
                                  </div>
                                  <input 
                                    type="number" 
                                    step="0.01"
                                    value={+currentLength.toFixed(3)}
                                    onChange={(e) => {
                                      const newLen = parseFloat(e.target.value);
                                      if (isNaN(newLen) || newLen <= 0) return;
                                      
                                      const angle = Math.atan2(dy, dx);
                                      const ratio = (scale?.ratioX || 1);
                                      const newPxLen = newLen * ratio;
                                      
                                      const newX2 = wall.points[0] + Math.cos(angle) * newPxLen;
                                      const newY2 = wall.points[1] + Math.sin(angle) * newPxLen;
                                      
                                      setWalls(prev => prev.map(w => w.id === selectedWallId ? {
                                        ...w,
                                        points: [w.points[0], w.points[1], newX2, newY2]
                                      } : w));
                                    }}
                                    className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-xs font-bold font-mono focus:ring-1 focus:ring-blue-400 outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-blue-500 uppercase">Thickness / Width ({scaleUnit})</label>
                                  <input 
                                    type="number" 
                                    step="0.005"
                                    value={+wall.thickness.toFixed(4)}
                                    onChange={(e) => {
                                      const t = parseFloat(e.target.value);
                                      if (!isNaN(t)) {
                                        setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, thickness: t } : w));
                                      }
                                    }}
                                    className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-xs font-bold font-mono focus:ring-1 focus:ring-blue-400 outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-blue-500 uppercase">Height ({scaleUnit})</label>
                                  <input 
                                    type="number" 
                                    step="0.05"
                                    value={+wall.height.toFixed(2)}
                                    onChange={(e) => {
                                      const h = parseFloat(e.target.value);
                                      if (!isNaN(h)) {
                                        setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, height: h } : w));
                                      }
                                    }}
                                    className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-xs font-bold font-mono focus:ring-1 focus:ring-blue-400 outline-none"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => {
                                    const std = scaleUnit === 'm' ? 0.115 : 0.425;
                                    setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, thickness: std } : w));
                                  }}
                                  className="flex-1 text-[9px] bg-white border border-blue-200 py-1 rounded-md font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                                >
                                  4.5" Wall
                                </button>
                                <button 
                                  onClick={() => {
                                    const std = scaleUnit === 'm' ? 0.230 : 0.75;
                                    setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, thickness: std } : w));
                                  }}
                                  className="flex-1 text-[9px] bg-white border border-blue-200 py-1 rounded-md font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                                >
                                  9" Wall
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Quantity Takeoff</label>
                        <button 
                          onClick={() => {
                            const csvHeader = "ID,Thickness,Length,SurfaceArea,Volume\n";
                            const csvRows = walls.map(w => {
                              const dx = w.points[2] - w.points[0];
                              const dy = w.points[3] - w.points[1];
                              const realX = Math.abs(dx) / (scale?.ratioX || 1);
                              const realY = Math.abs(dy) / (scale?.ratioY || 1);
                              const length = Math.sqrt(realX * realX + realY * realY);
                              const area = length * w.height * 2;
                              const volume = length * w.height * w.thickness;
                              return `${w.id},${w.thickness.toFixed(3)},${length.toFixed(2)},${area.toFixed(2)},${volume.toFixed(3)}`;
                            }).join("\n");
                            
                            const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.setAttribute('hidden', '');
                            a.setAttribute('href', url);
                            a.setAttribute('download', 'wall_takeoff.csv');
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          } }
                          className="text-[9px] font-bold text-blue-600 hover:text-blue-700 uppercase"
                        >
                          Export CSV
                        </button>
                      </div>
                      <div className="p-3 bg-slate-900 rounded-xl space-y-2 shadow-inner">
                        {Array.from(new Set(walls.map(w => w.thickness.toFixed(3)))).map(thick => {
                          const thickness = parseFloat(thick);
                          const filteredWalls = walls.filter(w => w.thickness.toFixed(3) === thick);
                          const totalLength = filteredWalls.reduce((acc, w) => {
                            const dx = w.points[2] - w.points[0];
                            const dy = w.points[3] - w.points[1];
                            const realX = Math.abs(dx) / (scale?.ratioX || 1);
                            const realY = Math.abs(dy) / (scale?.ratioY || 1);
                            return acc + Math.sqrt(realX * realX + realY * realY);
                          }, 0);
                          const totalSurfaceArea = filteredWalls.reduce((acc, w) => {
                            const dx = w.points[2] - w.points[0];
                            const dy = w.points[3] - w.points[1];
                            const realX = Math.abs(dx) / (scale?.ratioX || 1);
                            const realY = Math.abs(dy) / (scale?.ratioY || 1);
                            const length = Math.sqrt(realX * realX + realY * realY);
                            return acc + (length * w.height * 2); // Two faces
                          }, 0);

                          const totalVolume = filteredWalls.reduce((acc, w) => {
                            const dx = w.points[2] - w.points[0];
                            const dy = w.points[3] - w.points[1];
                            const realX = Math.abs(dx) / (scale?.ratioX || 1);
                            const realY = Math.abs(dy) / (scale?.ratioY || 1);
                            const length = Math.sqrt(realX * realX + realY * realY);
                            return acc + (length * w.height * w.thickness);
                          }, 0);

                          return (
                            <div key={thick} className="border-b border-white/10 last:border-0 pb-2 last:pb-0">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[9px] font-bold text-slate-400">T: {formatDimension(thickness, scaleUnit)}</span>
                                <span className="text-[9px] font-mono text-blue-400">{filteredWalls.length} units</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-[10px]">
                                <div>
                                  <p className="text-slate-500 uppercase text-[7px]">Length</p>
                                  <p className="font-bold text-white tracking-tight">{formatDimension(totalLength, scaleUnit)}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 uppercase text-[7px]">S. Area</p>
                                  <p className="font-bold text-white tracking-tight">{totalSurfaceArea.toFixed(1)} {areaUnitLabel}</p>
                                </div>
                                <div>
                                  <p className="text-slate-500 uppercase text-[7px]">Volume</p>
                                  <p className="font-bold text-white tracking-tight">{totalVolume.toFixed(2)} {volumeUnitLabel}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Placed Walls</label>
                      <button 
                        onClick={() => {
                          if (confirm("Are you sure you want to remove all walls?")) {
                            setWalls([]);
                            setSelectedWallId(null);
                          }
                        }}
                        className="text-[9px] font-bold text-red-500 hover:text-red-600 transition-colors"
                      >
                        Clear All
                      </button>
                    </div>
                      <div className="space-y-1">
                        {walls.map((wall, idx) => {
                           const isThin = wall.thickness < (scaleUnit === 'ft' ? 0.5 : 0.15);
                           return (
                            <div key={wall.id} className="group flex items-center justify-between p-2 bg-slate-50 border border-slate-100 rounded-lg hover:border-blue-200 transition-all">
                              <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-700">Wall #{idx + 1} ({isThin ? 'Internal' : 'External'})</span>
                                <span className="text-[9px] font-mono text-slate-400">{wall.thickness.toFixed(3)} {unitLabel} thick</span>
                              </div>
                              <button 
                                onClick={() => setWalls(prev => prev.filter(w => w.id !== wall.id))}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                              >
                                <X size={12} />
                              </button>
                            </div>
                           )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTool === 'scale' && (
              <div className="space-y-3">
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-[10px] font-bold text-blue-800 uppercase mb-1">To Define Scale:</p>
                  <ol className="text-[9px] text-blue-700 space-y-1 list-decimal ml-3">
                    <li>Find a known dimension on the blueprint.</li>
                    <li>Click the start of that dimension line.</li>
                    <li>Click the end of that line.</li>
                    <li>Enter the real length in the popup.</li>
                  </ol>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Scale Axis</label>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                    {(['both', 'x', 'y'] as const).map((axis) => (
                      <button
                        key={axis}
                        onClick={() => setScaleAxis(axis)}
                        className={cn(
                          "py-1 text-[9px] font-bold uppercase rounded transition-all",
                          scaleAxis === axis ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        {axis === 'both' ? 'Both' : axis.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">System Unit</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setScaleUnit('m')}
                      className={cn(
                        "flex-1 py-2 text-xs font-bold rounded-lg border transition-all",
                        scaleUnit === 'm' ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      Metric (m)
                    </button>
                    <button 
                      onClick={() => setScaleUnit('ft')}
                      className={cn(
                        "flex-1 py-2 text-xs font-bold rounded-lg border transition-all",
                        scaleUnit === 'ft' ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      Imperial (ft)
                    </button>
                  </div>
                </div>
                {scale && (
                   <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                     <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Current Ratio</p>
                     <p className="text-xs font-mono text-slate-600">X: 1:{scale.ratioX.toFixed(1)}px</p>
                     <p className="text-xs font-mono text-slate-600">Y: 1:{scale.ratioY.toFixed(1)}px</p>
                   </div>
                )}
              </div>
            )}

            {activeTool === 'dimension' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Dimension Options</label>
                  <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-xl flex items-center justify-center">
                    <p className="text-[10px] text-blue-600 font-medium text-center">Click two points on the canvas to measure segments.</p>
                  </div>
                </div>
                
                {dimensions.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Placed Dimensions</label>
                    <div className="space-y-1">
                      {dimensions.map((dim, idx) => {
                        const dx = dim.points[2] - dim.points[0];
                        const dy = dim.points[3] - dim.points[1];
                        const realX = Math.abs(dx) / (scale?.ratioX || 1);
                        const realY = Math.abs(dy) / (scale?.ratioY || 1);
                        const length = Math.sqrt(realX * realX + realY * realY);
                        
                        return (
                          <div key={dim.id} className="group flex items-center justify-between p-2 bg-slate-50 border border-slate-100 rounded-lg hover:border-blue-200 transition-all">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-bold text-slate-700">Dim #{idx + 1}</span>
                              <span className="text-[9px] font-mono text-slate-400">{formatDimension(length, scaleUnit)}</span>
                            </div>
                            <button 
                              onClick={() => setDimensions(prev => prev.filter(d => d.id !== dim.id))}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {activeTool === 'probe' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Thickness Probe</label>
                  <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl">
                    <p className="text-[10px] text-purple-700 font-medium text-center">Click two points across a wall section on the blueprint to detect its actual thickness. If a wall is selected, this will update its thickness directly.</p>
                  </div>
                </div>
                {lastThickProbe && (
                  <div className="p-3 bg-purple-600 rounded-lg shadow-sm">
                    <p className="text-[8px] font-bold text-purple-200 uppercase mb-1">Detected Thickness</p>
                    <p className="text-lg font-mono text-white tracking-tighter font-bold">
                       {formatDimension(lastThickProbe, scaleUnit)}
                    </p>
                    <p className="text-[8px] text-purple-100 italic mt-1 font-medium">Applied to next walls</p>
                  </div>
                )}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Take-off Tip</p>
                  <p className="text-[10px] leading-relaxed text-slate-500">Accurate thickness ensures correct material volume takeoff. Use this tool frequently for different wall types.</p>
                </div>
              </div>
            )}
            
            {activeTool === 'select' && (
              <div className="space-y-4">
                {selectedWallId ? (() => {
                  const selectedWall = walls.find(w => w.id === selectedWallId);
                  if (!selectedWall) return null;
                  
                  const dx = selectedWall.points[2] - selectedWall.points[0];
                  const dy = selectedWall.points[3] - selectedWall.points[1];
                  const realX = Math.abs(dx) / (scale?.ratioX || 1);
                  const realY = Math.abs(dy) / (scale?.ratioY || 1);
                  const length = Math.sqrt(realX * realX + realY * realY);

                  return (
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="text-xs font-bold text-blue-900 uppercase">Selected Wall</h4>
                            <p className="text-[9px] text-blue-600 font-mono">{selectedWall.id}</p>
                          </div>
                          <button 
                            onClick={() => setSelectedWallId(null)}
                            className="text-blue-400 hover:text-blue-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        
                        <div className="space-y-2">
                           <div className="flex justify-between text-[10px]">
                             <span className="text-slate-500">Length:</span>
                             <span className="font-bold text-slate-700">{formatDimension(length, scaleUnit)}</span>
                           </div>
                           <div className="flex justify-between text-[10px]">
                             <span className="text-slate-500">Thickness:</span>
                             <span className="font-bold text-slate-700">{formatDimension(selectedWall.thickness, scaleUnit)}</span>
                           </div>
                           <div className="flex justify-between text-[10px]">
                             <span className="text-slate-500">Height:</span>
                             <span className="font-bold text-slate-700">{formatDimension(selectedWall.height, scaleUnit)}</span>
                           </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Modify Thickness</label>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            step="0.001"
                            value={selectedWall.thickness}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, thickness: val } : w));
                            }}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-600 focus:outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Modify Height ({unitLabel})</label>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            step="0.1"
                            value={selectedWall.height}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, height: val } : w));
                            }}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-600 focus:outline-none transition-all"
                          />
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          setWalls(prev => prev.filter(w => w.id !== selectedWallId));
                          setSelectedWallId(null);
                        }}
                        className="w-full py-2 bg-red-50 text-red-600 border border-red-100 rounded-lg text-xs font-bold hover:bg-red-100 transition-colors"
                      >
                        Delete Wall
                      </button>
                    </div>
                  );
                })() : (
                  <div className="py-8 text-center border border-dashed border-slate-100 rounded-xl">
                    <MousePointer2 className="w-8 h-8 mx-auto mb-3 text-slate-200" />
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Select a wall on the canvas</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-b border-slate-100">
          <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
            <Calculator size={14} className="text-slate-300" /> Take-off Data
          </h3>
          
            <div className="space-y-3">
              {scale ? (
                <>
                  <StatRow label="Total Perimeter" value={formatDimension(totalLength, scaleUnit)} />
                  <StatRow label="Total Surface Area" value={`${totalArea.toFixed(2)} ${areaUnitLabel}`} />
                  <StatRow label="Total Volume" value={`${totalVolume.toFixed(3)} ${volumeUnitLabel}`} />
                  <div className="pt-3 mt-3 border-t border-slate-50">
                    <StatRow label="Managed Segments" value={`${walls.length} Detected`} />
                  </div>
                </>
              ) : (
                <div className="py-4 text-center border-2 border-dashed border-slate-100 rounded-lg">
                  <Scaling className="w-8 h-8 mx-auto mb-2 text-slate-200" />
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Define scale to see takeoff</p>
                </div>
              )}
            </div>
        </div>

        <div className="p-5 flex-1 overflow-auto opacity-40 grayscale pointer-events-none border-t border-slate-50">
          <h3 className="text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-2">
            <ClipboardList size={14} className="text-slate-300" /> Cost Estimation Disabled
          </h3>
          <p className="text-[9px] text-slate-400 leading-relaxed">Cost estimation module is disabled per project settings. Focus on Quantity Takeoff only.</p>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100">
          <button className="w-full py-2 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm shadow-blue-100">
            Export Detailed Report
          </button>
        </div>
      </aside>

      {/* Scaling Modal */}
      <AnimatePresence>
        {showScaleModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 text-center"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white border border-slate-200 p-8 rounded-2xl max-w-sm w-full shadow-2xl"
            >
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Scaling size={24} />
              </div>
              <h2 className="text-lg font-bold text-slate-800 mb-1">Define Scaling</h2>
              <p className="text-sm text-slate-500 mb-6">Enter the real-world length of the line you just drew ({unitLabel}).</p>
              
              <div className="flex gap-2 items-center mb-6">
                <input 
                  type="number" 
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-center text-2xl font-bold focus:border-blue-600 focus:ring-4 focus:ring-blue-50 focus:outline-none transition-all"
                  value={realLengthInput}
                  onChange={(e) => setRealLengthInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmScale()}
                />
                <select 
                  value={scaleUnit}
                  onChange={(e) => setScaleUnit(e.target.value as 'm' | 'ft')}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-3 font-bold text-slate-600 focus:outline-none"
                >
                  <option value="m">m</option>
                  <option value="ft">ft</option>
                </select>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowScaleModal(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmScale}
                  className="flex-1 py-3 text-sm font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                >
                  Set Scale
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const ToolButton = ({ active, icon, label, onClick, disabled }: { active?: boolean, icon: React.ReactNode, label: string, onClick?: () => void, disabled?: boolean }) => (
  <button 
    onClick={!disabled ? onClick : undefined}
    className={cn(
      "w-10 h-10 flex items-center justify-center rounded-lg relative group transition-all",
      active ? "active-tool" : "text-slate-400 hover:text-blue-600",
      disabled && "opacity-30 cursor-not-allowed grayscale"
    )}
  >
    {icon}
    <div className="absolute left-14 hidden group-hover:block bg-slate-800 text-white p-1 px-2 rounded text-[10px] font-bold whitespace-nowrap z-50 shadow-xl pointer-events-none">
      {label}
    </div>
  </button>
);

const StatRow = ({ label, value }: { label: string, value: string }) => (
  <div className="flex justify-between items-center py-1">
    <span className="text-xs text-slate-500">{label}</span>
    <span className="text-xs font-semibold text-slate-800">{value}</span>
  </div>
);

const CostItem = ({ name, qty, unit, price }: { name: string, qty: string, unit: string, price: number }) => (
  <div className="flex justify-between items-center py-1 border-b border-slate-50">
    <div className="flex flex-col">
      <span className="text-xs font-medium text-slate-700">{name}</span>
      <span className="text-[10px] text-slate-400">{qty} {unit} @ ${price}</span>
    </div>
    <span className="text-xs font-bold text-slate-800">${(parseFloat(qty) * price).toLocaleString()}</span>
  </div>
);
