import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer, Line, Rect, Image as KonvaImage, Group, Text, Circle } from 'react-konva';
import useImage from 'use-image';
import { Plus, Minus, Maximize } from 'lucide-react';
import { Point, Wall, Tool, Scale, Dimension } from '../types';
import { cn, formatDimension, getDistanceToSegment } from '../lib/utils';

interface CanvasProps {
  tool: Tool;
  bgImageUrl?: string;
  walls: Wall[];
  setWalls: React.Dispatch<React.SetStateAction<Wall[]>>;
  dimensions: Dimension[];
  setDimensions: React.Dispatch<React.SetStateAction<Dimension[]>>;
  scale: Scale | null;
  onScaleDefine: (px: number) => void;
  onProbeDefine: (px: number) => void;
  currentThickness: number;
  currentHeight: number;
  selectedWallId: string | null;
  onSelectWall: (id: string | null) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ 
  tool, 
  bgImageUrl, 
  walls, 
  setWalls, 
  dimensions,
  setDimensions,
  scale,
  onScaleDefine,
  onProbeDefine,
  currentThickness,
  currentHeight,
  selectedWallId,
  onSelectWall
}) => {
  const [bgImage] = useImage(bgImageUrl || '');
  const [newWall, setNewWall] = useState<number[] | null>(null);
  const [newDimension, setNewDimension] = useState<number[] | null>(null);
  const [probeLine, setProbeLine] = useState<number[] | null>(null);
  const [hoveredWallId, setHoveredWallId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [scaleLine, setScaleLine] = useState<number[] | null>(null);
  const stageRef = useRef<any>(null);

  useEffect(() => {
    const handleResize = () => {
      setStageSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [isShiftDown, setIsShiftDown] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftDown(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftDown(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const getSnappedPos = (start: Point, current: Point) => {
    if (!isShiftDown) return current;
    const dx = Math.abs(current.x - start.x);
    const dy = Math.abs(current.y - start.y);
    if (dx > dy) {
      return { x: current.x, y: start.y }; // Horizontal
    } else {
      return { x: start.x, y: current.y }; // Vertical
    }
  };

  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);

  const snapToGrid = (x: number, y: number) => {
    // Simple 1px snap for precision, can be increased if needed
    return { x: Math.round(x), y: Math.round(y) };
  };

  const findSnapPoint = (x: number, y: number, excludeId: string) => {
    const snapDist = 15;
    for (const wall of walls) {
      if (wall.id === excludeId) continue;
      // Check both endpoints of each other wall
      const d1 = Math.sqrt((x - wall.points[0])**2 + (y - wall.points[1])**2);
      const d2 = Math.sqrt((x - wall.points[2])**2 + (y - wall.points[3])**2);
      
      if (d1 < snapDist) return { x: wall.points[0], y: wall.points[1], snapped: true };
      if (d2 < snapDist) return { x: wall.points[2], y: wall.points[3], snapped: true };
    }
    return { x, y, snapped: false };
  };

  const handleMouseDown = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getRelativePointerPosition();

    if (tool === "select") {
      onSelectWall(selectedWallId === hoveredWallId ? null : hoveredWallId);
      return;
    }

    if (drawingPoints.length === 0) {
      // First click: Start point
      setDrawingPoints([pos]);
      if (tool === "wall") {
        setNewWall([pos.x, pos.y, pos.x, pos.y]);
      } else if (tool === "dimension") {
        setNewDimension([pos.x, pos.y, pos.x, pos.y]);
      } else if (tool === "scale") {
        setScaleLine([pos.x, pos.y, pos.x, pos.y]);
      } else if (tool === "probe") {
        setProbeLine([pos.x, pos.y, pos.x, pos.y]);
      }
    } else {
      // Second click: End point
      const start = drawingPoints[0];
      const snapped = getSnappedPos(start, pos);

      if (tool === "wall") {
        const wall: Wall = {
          id: Math.random().toString(36).substr(2, 9),
          points: [start.x, start.y, snapped.x, snapped.y],
          thickness: currentThickness,
          height: currentHeight,
          color: '#1e293b'
        };
        setWalls([...walls, wall]);
        setNewWall(null);
      } else if (tool === "dimension") {
        const dimension: Dimension = {
          id: Math.random().toString(36).substr(2, 9),
          points: [start.x, start.y, snapped.x, snapped.y],
          color: '#ef4444'
        };
        setDimensions([...dimensions, dimension]);
        setNewDimension(null);
      } else if (tool === "scale") {
        const dx = snapped.x - start.x;
        const dy = snapped.y - start.y;
        const pxLength = Math.sqrt(dx * dx + dy * dy);
        onScaleDefine(pxLength);
        setScaleLine(null);
      } else if (tool === "probe") {
        const dx = pos.x - drawingPoints[0].x;
        const dy = pos.y - drawingPoints[0].y;
        onProbeDefine(Math.sqrt(dx * dx + dy * dy));
        setProbeLine(null);
      }
      setDrawingPoints([]);
    }
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getRelativePointerPosition();

    if (tool === "select" && drawingPoints.length === 0) {
      let closestWallId: string | null = null;
      let minDistance = 15; // 15px threshold for easier selection

      walls.forEach(wall => {
        const dist = getDistanceToSegment(pos.x, pos.y, wall.points[0], wall.points[1], wall.points[2], wall.points[3]);
        if (dist < minDistance) {
          minDistance = dist;
          closestWallId = wall.id;
        }
      });
      setHoveredWallId(closestWallId);
    }

    if (drawingPoints.length === 0) return;
    
    const start = drawingPoints[0];
    const snapped = getSnappedPos(start, pos);

    if (tool === "wall") {
      setNewWall([start.x, start.y, snapped.x, snapped.y]);
    } else if (tool === "dimension") {
      setNewDimension([start.x, start.y, snapped.x, snapped.y]);
    } else if (tool === "scale") {
      setScaleLine([start.x, start.y, snapped.x, snapped.y]);
    } else if (tool === "probe") {
      setProbeLine([start.x, start.y, pos.x, pos.y]); // No snap for probe
    }
  };

  const handleMouseUp = () => {
    // No longer adding items on mouse up to support two-click interaction
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;

    stage.scale({ x: newScale, y: newScale });

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    stage.position(newPos);
  };

  const resetZoom = () => {
    const stage = stageRef.current;
    if (stage) {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
    }
  };

  const zoomIn = () => {
    const stage = stageRef.current;
    if (stage) {
      const oldScale = stage.scaleX();
      const newScale = oldScale * 1.2;
      stage.scale({ x: newScale, y: newScale });
    }
  };

  const zoomOut = () => {
    const stage = stageRef.current;
    if (stage) {
      const oldScale = stage.scaleX();
      const newScale = oldScale / 1.2;
      stage.scale({ x: newScale, y: newScale });
    }
  };

  const ratioX = scale ? scale.ratioX : 1;
  const ratioY = scale ? scale.ratioY : 1;
  const unit = scale?.unit || "m";

  return (
    <div 
      className={cn(
        "w-full h-full relative blueprint-bg overflow-hidden group/canvas",
        tool === 'scale' && "cursor-crosshair",
        tool === 'wall' && "cursor-cell"
      )}
    >
      <div className="absolute inset-0 blueprint-bg-small opacity-50 pointer-events-none" />
      
      {/* Tool Hint */}
      {tool === 'scale' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-blue-200 pointer-events-none animate-pulse">
          {drawingPoints.length === 0 ? "Click Start of Scale Reference" : "Click End of Scale Reference (Shift to Snap)"}
        </div>
      )}

      {tool === 'dimension' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-red-200 pointer-events-none animate-pulse">
          {drawingPoints.length === 0 ? "Click Start Point for Dimension" : "Click End Point (Shift to Snap)"}
        </div>
      )}

      {tool === 'wall' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-slate-800 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-slate-200 pointer-events-none animate-pulse">
          {drawingPoints.length === 0 ? "Click to Start Wall" : "Click to Finish Wall (Shift to Snap)"}
        </div>
      )}

      {tool === 'probe' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 bg-purple-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-purple-200 pointer-events-none animate-pulse">
          {drawingPoints.length === 0 ? "Click Start of Probe" : "Click End of Probe"}
        </div>
      )}

      {/* Floating Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-30 opacity-0 group-hover/canvas:opacity-100 transition-opacity">
        <button 
          onClick={zoomIn}
          className="w-10 h-10 bg-white border border-slate-200 rounded-lg shadow-lg flex items-center justify-center text-slate-600 hover:text-blue-600 transition-colors"
        >
          <Plus size={20} />
        </button>
        <button 
          onClick={zoomOut}
          className="w-10 h-10 bg-white border border-slate-200 rounded-lg shadow-lg flex items-center justify-center text-slate-600 hover:text-blue-600 transition-colors"
        >
          <Minus size={20} />
        </button>
        <button 
          onClick={resetZoom}
          className="w-10 h-10 bg-white border border-slate-200 rounded-lg shadow-lg flex items-center justify-center text-slate-400 hover:text-slate-800 transition-colors"
        >
          <Maximize size={16} />
        </button>
      </div>

      <Stage
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        ref={stageRef}
        draggable={tool === 'select'}
      >
        <Layer>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              opacity={0.4}
              listening={false}
            />
          )}

            {walls.map((wall) => {
            const distDx = wall.points[2] - wall.points[0];
            const distDy = wall.points[3] - wall.points[1];
            
            const realX = Math.abs(distDx) / ratioX;
            const realY = Math.abs(distDy) / ratioY;
            
            // Segregation logic: Thin walls (internal) are lighter blue, thick walls (external) are dark slate
            const isThin = wall.thickness < (scale?.unit === 'ft' ? 0.5 : 0.15);
            const wallColor = isThin ? '#64748b' : '#1e293b'; 

            const angleRad = Math.atan2(distDy, distDx);
            const angleDeg = angleRad * 180 / Math.PI;
            const nx = -Math.sin(angleRad);
            const ny = Math.cos(angleRad);
            
            const wallStrokeWidth = wall.thickness * ((ratioX + ratioY) / 2);
            const halfThick = wallStrokeWidth / 2;
            const lengthVal = Math.sqrt(realX * realX + realY * realY);

            const isHovered = wall.id === hoveredWallId;
            const isSelected = wall.id === selectedWallId;

            return (
              <Group key={wall.id}>
                {/* Wall Interaction Logic */}
                <Group onClick={() => onSelectWall(wall.id)}>
                  {/* Visual Highlight for selection mode */}
                  {(isHovered || isSelected) && (
                    <Line
                      points={wall.points}
                      stroke={isSelected ? "#3b82f6" : "#cbd5e1"}
                      strokeWidth={wallStrokeWidth + (isSelected ? 10 : 4)}
                      lineCap="butt"
                      opacity={isSelected ? 0.4 : 0.2}
                      shadowColor="#3b82f6"
                      shadowBlur={isSelected ? 15 : 0}
                      shadowOpacity={0.6}
                    />
                  )}
                  
                  {/* Main Wall Body (The Fill) */}
                  <Line
                    points={wall.points}
                    stroke={wallColor}
                    strokeWidth={wallStrokeWidth}
                    lineCap="butt"
                    opacity={isThin ? (isSelected ? 0.6 : 0.2) : (isSelected ? 0.8 : 0.4)}
                  />

                  {/* Wall Faces (Parallel Casing Lines) */}
                  <Line
                    points={[
                      wall.points[0] + nx * halfThick, wall.points[1] + ny * halfThick,
                      wall.points[2] + nx * halfThick, wall.points[3] + ny * halfThick
                    ]}
                    stroke={wallColor}
                    strokeWidth={0.8}
                    lineCap="butt"
                    opacity={0.9}
                  />
                  <Line
                    points={[
                      wall.points[0] - nx * halfThick, wall.points[1] - ny * halfThick,
                      wall.points[2] - nx * halfThick, wall.points[3] - ny * halfThick
                    ]}
                    stroke={wallColor}
                    strokeWidth={0.8}
                    lineCap="butt"
                    opacity={0.9}
                  />
                </Group>

                {/* Draggable Endpoint Anchors (Only for selected wall) */}
                {isSelected && (
                  <>
                    {/* Ghost connection line during drag (visual guide) */}
                    <Line
                      points={wall.points}
                      stroke="#3b82f6"
                      strokeWidth={1}
                      dash={[4, 4]}
                      opacity={0.5}
                    />
                    
                    <Circle
                      x={wall.points[0]}
                      y={wall.points[1]}
                      radius={isSelected ? 8 : 0}
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth={2}
                      shadowBlur={6}
                      shadowColor="#000"
                      shadowOpacity={0.2}
                      draggable
                      onMouseEnter={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'move';
                        e.target.scale({ x: 1.3, y: 1.3 });
                      }}
                      onMouseLeave={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'default';
                        e.target.scale({ x: 1, y: 1 });
                      }}
                      onDragMove={(e) => {
                        const stage = e.target.getStage();
                        if (!stage) return;
                        const pos = stage.getRelativePointerPosition();
                        
                        // Try snapping to other walls first
                        let point = findSnapPoint(pos.x, pos.y, wall.id);
                        
                        // If not snapped, use grid snap
                        if (!point.snapped) {
                          const gridSnapped = snapToGrid(pos.x, pos.y);
                          point.x = gridSnapped.x;
                          point.y = gridSnapped.y;
                        }
                        
                        // Shift constraint takes precedence if active
                        if (isShiftDown) {
                          const otherPoint = { x: wall.points[2], y: wall.points[3] };
                          const dx = Math.abs(point.x - otherPoint.x);
                          const dy = Math.abs(point.y - otherPoint.y);
                          if (dx > dy) point.y = otherPoint.y;
                          else point.x = otherPoint.x;
                        }

                        setWalls(prev => prev.map(w => w.id === wall.id ? { 
                          ...w, 
                          points: [point.x, point.y, w.points[2], w.points[3]] 
                        } : w));
                      }}
                    />
                    <Circle
                      x={wall.points[2]}
                      y={wall.points[3]}
                      radius={isSelected ? 8 : 0}
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth={2}
                      shadowBlur={6}
                      shadowColor="#000"
                      shadowOpacity={0.2}
                      draggable
                      onMouseEnter={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'move';
                        e.target.scale({ x: 1.3, y: 1.3 });
                      }}
                      onMouseLeave={(e) => {
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = 'default';
                        e.target.scale({ x: 1, y: 1 });
                      }}
                      onDragMove={(e) => {
                        const stage = e.target.getStage();
                        if (!stage) return;
                        const pos = stage.getRelativePointerPosition();
                        
                        // Try snapping to other walls first
                        let point = findSnapPoint(pos.x, pos.y, wall.id);
                        
                        // If not snapped, use grid snap
                        if (!point.snapped) {
                          const gridSnapped = snapToGrid(pos.x, pos.y);
                          point.x = gridSnapped.x;
                          point.y = gridSnapped.y;
                        }
                        
                        // Shift constraint takes precedence if active
                        if (isShiftDown) {
                          const otherPoint = { x: wall.points[0], y: wall.points[1] };
                          const dx = Math.abs(point.x - otherPoint.x);
                          const dy = Math.abs(point.y - otherPoint.y);
                          if (dx > dy) point.y = otherPoint.y;
                          else point.x = otherPoint.x;
                        }

                        setWalls(prev => prev.map(w => w.id === wall.id ? { 
                          ...w, 
                          points: [w.points[0], w.points[1], point.x, point.y] 
                        } : w));
                      }}
                    />
                  </>
                )}
                
                {/* Wall Dimension Label */}
                {scale && lengthVal > 0 && (
                  <Group
                    x={(wall.points[0] + wall.points[2]) / 2}
                    y={(wall.points[1] + wall.points[3]) / 2}
                    rotation={angleDeg % 180 > 90 || angleDeg % 180 < -90 ? angleDeg + 180 : angleDeg}
                  >
                    <Rect 
                      width={isSelected ? 50 : 40}
                      height={isSelected ? 16 : 12}
                      fill={isSelected ? "#1d4ed8" : "rgba(30, 41, 59, 0.8)"}
                      offsetX={isSelected ? 25 : 20}
                      offsetY={isSelected ? 8 : 6}
                      cornerRadius={2}
                      shadowBlur={isSelected ? 4 : 0}
                      shadowColor="black"
                      shadowOpacity={0.3}
                    />
                    <Text
                      text={formatDimension(lengthVal, unit)}
                      fill="#FFFFFF"
                      fontSize={isSelected ? 10 : 8}
                      fontStyle="bold"
                      fontFamily="JetBrains Mono"
                      align="center"
                      width={isSelected ? 50 : 40}
                      offsetX={isSelected ? 25 : 20}
                      offsetY={isSelected ? 6 : 4}
                    />
                  </Group>
                )}
              </Group>
            );
          })}

          {dimensions.map((dim) => {
            const dx = dim.points[2] - dim.points[0];
            const dy = dim.points[3] - dim.points[1];
            
            const realX = Math.abs(dx) / ratioX;
            const realY = Math.abs(dy) / ratioY;
            const lengthVal = Math.sqrt(realX * realX + realY * realY);
            
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;

            return (
              <Group key={dim.id}>
                <Line
                  points={dim.points}
                  stroke={dim.color}
                  strokeWidth={1.5}
                  dash={[5, 2]}
                />
                {/* Dimension Ticks */}
                <Group x={dim.points[0]} y={dim.points[1]}>
                  <Line points={[-5, -5, 5, 5]} stroke={dim.color} strokeWidth={1} rotation={angle + 45} />
                </Group>
                <Group x={dim.points[2]} y={dim.points[3]}>
                  <Line points={[-5, -5, 5, 5]} stroke={dim.color} strokeWidth={1} rotation={angle + 45} />
                </Group>

                <Group
                  x={(dim.points[0] + dim.points[2]) / 2}
                  y={(dim.points[1] + dim.points[3]) / 2}
                  rotation={angle % 180 > 90 || angle % 180 < -90 ? angle + 180 : angle}
                >
                  <Rect 
                    width={45}
                    height={14}
                    fill="#FFFFFF"
                    stroke={dim.color}
                    strokeWidth={0.5}
                    offsetX={22.5}
                    offsetY={18}
                    cornerRadius={2}
                  />
                  <Text
                    text={formatDimension(lengthVal, unit)}
                    fill={dim.color}
                    fontSize={9}
                    fontStyle="bold"
                    fontFamily="JetBrains Mono"
                    align="center"
                    width={45}
                    offsetX={22.5}
                    offsetY={16}
                  />
                </Group>
              </Group>
            );
          })}

          {newWall && (
            <Group>
              <Line
                points={newWall}
                stroke="#3b82f6"
                strokeWidth={2}
                lineCap="round"
                dash={[8, 4]}
              />
              <Circle x={newWall[0]} y={newWall[1]} radius={3} fill="#3b82f6" />
              <Circle x={newWall[2]} y={newWall[3]} radius={3} fill="#3b82f6" />

              {/* Auxiliary lines and measurements - Only show if scale is defined */}
              {scale && (
                <>
                  {/* Horizontal auxiliary */}
                  {Math.abs(newWall[2] - newWall[0]) > 10 && (
                    <>
                      <Line 
                        points={[newWall[0], newWall[1], newWall[2], newWall[1]]}
                        stroke="#3b82f6"
                        strokeWidth={1}
                        dash={[2, 2]}
                        opacity={0.5}
                      />
                      <Text 
                        x={(newWall[0] + newWall[2]) / 2}
                        y={newWall[1] - 18}
                        text={formatDimension(Math.abs(newWall[2] - newWall[0]) / ratioX, unit)}
                        fill="#3b82f6"
                        fontSize={10}
                        fontStyle="bold"
                        fontFamily="JetBrains Mono"
                        align="center"
                      />
                    </>
                  )}
                  {/* Vertical auxiliary */}
                  {Math.abs(newWall[3] - newWall[1]) > 10 && (
                    <>
                      <Line 
                        points={[newWall[2], newWall[1], newWall[2], newWall[3]]}
                        stroke="#f59e0b"
                        strokeWidth={1}
                        dash={[2, 2]}
                        opacity={0.5}
                      />
                      <Text 
                        x={newWall[2] + 12}
                        y={(newWall[1] + newWall[3]) / 2}
                        text={formatDimension(Math.abs(newWall[3] - newWall[1]) / ratioY, unit)}
                        fill="#f59e0b"
                        fontSize={10}
                        fontStyle="bold"
                        fontFamily="JetBrains Mono"
                      />
                    </>
                  )}
                </>
              )}
            </Group>
          )}

          {newDimension && (
            <Group>
               <Line
                  points={newDimension}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  dash={[5, 2]}
                />
                <Circle x={newDimension[0]} y={newDimension[1]} radius={3} fill="#ef4444" />
                <Circle x={newDimension[2]} y={newDimension[3]} radius={3} fill="#ef4444" />
            </Group>
          )}

          {scaleLine && (
            <Group>
              <Line
                points={scaleLine}
                stroke="#1d4ed8"
                strokeWidth={1}
                dash={[4, 2]}
              />
              <Rect 
                x={(scaleLine[0] + scaleLine[2]) / 2 - 60}
                y={(scaleLine[1] + scaleLine[3]) / 2 - 25}
                width={120}
                height={16}
                fill="#eff6ff"
                stroke="#3b82f6"
                strokeWidth={0.5}
                cornerRadius={4}
              />
              <Text 
                x={(scaleLine[0] + scaleLine[2]) / 2}
                y={(scaleLine[1] + scaleLine[3]) / 2 - 21}
                text="SETTING SCALE REFERENCE"
                fill="#1d4ed8"
                fontSize={8}
                fontStyle="bold"
                fontFamily="JetBrains Mono"
                align="center"
                offsetX={60}
                width={120}
              />
              <Text 
                x={(scaleLine[0] + scaleLine[2]) / 2}
                y={(scaleLine[1] + scaleLine[3]) / 2 + 10}
                text={`${Math.abs(scaleLine[2] - scaleLine[0]).toFixed(0)}px H | ${Math.abs(scaleLine[3] - scaleLine[1]).toFixed(0)}px V`}
                fill="#3b82f6"
                fontSize={9}
                fontFamily="JetBrains Mono"
                align="center"
                offsetX={60}
                width={120}
              />
              <Circle x={scaleLine[0]} y={scaleLine[1]} radius={3} fill="#ef4444" />
              <Circle x={scaleLine[2]} y={scaleLine[3]} radius={3} fill="#ef4444" />
            </Group>
          )}

          {probeLine && (
            <Group>
              <Line
                points={probeLine}
                stroke="#8b5cf6"
                strokeWidth={1}
                dash={[2, 2]}
              />
              <Circle x={probeLine[0]} y={probeLine[1]} radius={3} fill="#8b5cf6" />
              <Circle x={probeLine[2]} y={probeLine[3]} radius={3} fill="#8b5cf6" />
              
              <Group x={(probeLine[0] + probeLine[2]) / 2} y={(probeLine[1] + probeLine[3]) / 2}>
                <Rect 
                  width={60} 
                  height={14} 
                  fill="#f5f3ff" 
                  stroke="#8b5cf6" 
                  strokeWidth={0.5} 
                  offsetX={30} 
                  offsetY={20} 
                  cornerRadius={2} 
                />
                <Text 
                  text={formatDimension(Math.sqrt((probeLine[2] - probeLine[0])**2 + (probeLine[3] - probeLine[1])**2) / ((ratioX + ratioY) / 2), unit)}
                  fill="#7c3aed"
                  fontSize={9}
                  fontStyle="bold"
                  fontFamily="JetBrains Mono"
                  align="center"
                  width={60}
                  offsetX={30}
                  offsetY={18}
                />
              </Group>
            </Group>
          )}
        </Layer>
      </Stage>
    </div>
  );
};
