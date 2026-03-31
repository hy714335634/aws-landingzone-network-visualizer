import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, NodeTypes, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toSvg } from 'html-to-image';

import type { NetworkConfig } from '../types/network';
import { parseNetworkConfig, parseNetworkConfigSimplified } from '../utils/networkParser';
import { validateNetworkConfig } from '../utils/configValidator';
import type { ValidationMessage } from '../utils/configValidator';
import { useLanguage } from '../i18n/LanguageContext';
import { useUndoRedo } from '../hooks/useUndoRedo';
import VpcNode from './nodes/VpcNode';
import TgwNode from './nodes/TgwNode';
import SubnetNode from './nodes/SubnetNode';
import SubnetGroupNode from './nodes/SubnetGroupNode';
import RegionNode from './nodes/RegionNode';
import AzNode from './nodes/AzNode';
import TopoVpcNode from './nodes/SimpleVpcNode';
import TopoTgwNode from './nodes/SimpleTgwNode';
import TopoAccountNode from './nodes/TopoAccountNode';
import TopoComponentNode from './nodes/TopoComponentNode';
import TopoRegionLabelNode from './nodes/TopoRegionLabelNode';
import TopoEndpointNode from './nodes/TopoEndpointNode';
import TopoDxNode from './nodes/TopoDxNode';
import FileUpload from './FileUpload';
import JsonEditorPanel from './JsonEditorPanel';
import Toolbar from './Toolbar';
import type { ViewMode } from './Toolbar';
import ResourceManager from './ResourceManager';
import { useOverlayStore } from '../hooks/useOverlayStore';
import { VpnNode, CgwNode, VgwNode, PrivateLinkNode } from './nodes/OverlayNodes';
import { renderOverlayResources } from '../utils/overlayRenderer';
import type { ReachabilityResult } from '../utils/reachabilityAnalyzer';
// SearchOverlay available as standalone, but search is now embedded in Toolbar

// ============================================
// Change tracking types & logic
// ============================================
export interface ChangeLogEntry {
  type: 'added' | 'removed' | 'modified';
  kind: string; // 'VPC', 'TGW', 'Route Table', 'Region', etc.
  name: string;
  jsonPath: string;
  source: 'json' | 'overlay'; // whether this change is in JSON config or overlay/manual
}

function computeChanges(base: NetworkConfig, current: NetworkConfig): ChangeLogEntry[] {
  const changes: ChangeLogEntry[] = [];
  const ROOT_KEYS = ['vpcs', 'tgw', 'resolver', 'dx', 'variables'];

  const S: 'json' = 'json';

  // Compare VPCs
  function diffVpcs(baseVpcs: Record<string, unknown> | undefined, curVpcs: Record<string, unknown> | undefined, prefix: string) {
    const bk = Object.keys(baseVpcs || {});
    const ck = Object.keys(curVpcs || {});
    ck.forEach(k => {
      if (!bk.includes(k)) changes.push({ type: 'added', kind: 'VPC', name: k, jsonPath: `${prefix}vpcs.${k}`, source: S });
      else if (JSON.stringify((baseVpcs as Record<string, unknown>)[k]) !== JSON.stringify((curVpcs as Record<string, unknown>)[k]))
        changes.push({ type: 'modified', kind: 'VPC', name: k, jsonPath: `${prefix}vpcs.${k}`, source: S });
    });
    bk.forEach(k => {
      if (!ck.includes(k)) changes.push({ type: 'removed', kind: 'VPC', name: k, jsonPath: `${prefix}vpcs.${k}`, source: S });
    });
  }

  // Compare TGW
  function diffTgw(baseTgw: unknown, curTgw: unknown, prefix: string) {
    if (!baseTgw && curTgw) changes.push({ type: 'added', kind: 'TGW', name: 'Transit Gateway', jsonPath: `${prefix}tgw`, source: S });
    else if (baseTgw && !curTgw) changes.push({ type: 'removed', kind: 'TGW', name: 'Transit Gateway', jsonPath: `${prefix}tgw`, source: S });
    else if (baseTgw && curTgw && JSON.stringify(baseTgw) !== JSON.stringify(curTgw)) {
      changes.push({ type: 'modified', kind: 'TGW', name: 'Transit Gateway', jsonPath: `${prefix}tgw`, source: S });
      const bt = (baseTgw as Record<string, unknown>).tables as Record<string, unknown> | undefined;
      const ct = (curTgw as Record<string, unknown>).tables as Record<string, unknown> | undefined;
      if (bt || ct) {
        const btk = Object.keys(bt || {});
        const ctk = Object.keys(ct || {});
        ctk.forEach(k => { if (!btk.includes(k)) changes.push({ type: 'added', kind: 'Route Table', name: k, jsonPath: `${prefix}tgw.tables.${k}`, source: S }); });
        btk.forEach(k => { if (!ctk.includes(k)) changes.push({ type: 'removed', kind: 'Route Table', name: k, jsonPath: `${prefix}tgw.tables.${k}`, source: S }); });
      }
    }
  }

  // Main region
  diffVpcs(base.vpcs as Record<string, unknown>, current.vpcs as Record<string, unknown>, '');
  diffTgw(base.tgw, current.tgw, '');

  // Resolver / DX
  if (!base.resolver && current.resolver) changes.push({ type: 'added', kind: 'Resolver', name: 'Route 53 Resolver', jsonPath: 'resolver', source: S });
  else if (base.resolver && !current.resolver) changes.push({ type: 'removed', kind: 'Resolver', name: 'Route 53 Resolver', jsonPath: 'resolver', source: S });
  else if (base.resolver && current.resolver && JSON.stringify(base.resolver) !== JSON.stringify(current.resolver))
    changes.push({ type: 'modified', kind: 'Resolver', name: 'Route 53 Resolver', jsonPath: 'resolver', source: S });

  if (!base.dx && current.dx) changes.push({ type: 'added', kind: 'DX', name: 'Direct Connect', jsonPath: 'dx', source: S });
  else if (base.dx && !current.dx) changes.push({ type: 'removed', kind: 'DX', name: 'Direct Connect', jsonPath: 'dx', source: S });
  else if (base.dx && current.dx && JSON.stringify(base.dx) !== JSON.stringify(current.dx))
    changes.push({ type: 'modified', kind: 'DX', name: 'Direct Connect', jsonPath: 'dx', source: S });

  // Peer regions
  const allKeys = new Set([...Object.keys(base), ...Object.keys(current)]);
  allKeys.forEach(key => {
    if (ROOT_KEYS.includes(key)) return;
    const bv = base[key] as Record<string, unknown> | undefined;
    const cv = current[key] as Record<string, unknown> | undefined;
    if (!bv && cv && typeof cv === 'object' && 'vpcs' in cv) {
      changes.push({ type: 'added', kind: 'Region', name: key, jsonPath: key, source: S });
    } else if (bv && !cv) {
      changes.push({ type: 'removed', kind: 'Region', name: key, jsonPath: key, source: S });
    } else if (bv && cv && typeof bv === 'object' && 'vpcs' in bv && typeof cv === 'object' && 'vpcs' in cv) {
      diffVpcs(bv.vpcs as Record<string, unknown>, cv.vpcs as Record<string, unknown>, `${key}.`);
      diffTgw(bv.tgw, cv.tgw, `${key}.`);
    }
  });

  return changes;
}

const nodeTypes: NodeTypes = {
  vpc: VpcNode,
  tgw: TgwNode,
  subnet: SubnetNode,
  subnetGroup: SubnetGroupNode,
  region: RegionNode,
  az: AzNode,
  topoVpc: TopoVpcNode,
  topoTgw: TopoTgwNode,
  topoAccount: TopoAccountNode,
  topoComponent: TopoComponentNode,
  topoRegionLabel: TopoRegionLabelNode,
  topoEndpoint: TopoEndpointNode,
  topoDx: TopoDxNode,
  overlayVpn: VpnNode,
  overlayCgw: CgwNode,
  overlayVgw: VgwNode,
  overlayPrivateLink: PrivateLinkNode,
};

function NetworkFlowInner() {
  const { lang, t } = useLanguage();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [showUpload, setShowUpload] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('detailed');
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<{
    nodeIds: Set<string>;
    edgeIds: Set<string>;
    sourceId: string;
    destId: string;
  } | null>(null);

  const [showDiff, setShowDiff] = useState(false);
  const [diffBaseConfig, setDiffBaseConfig] = useState<NetworkConfig | null>(null);
  const diffFileRef = useRef<HTMLInputElement>(null);

  const overlayStore = useOverlayStore();

  // 保留完整原始 JSON 对象（包含未可视化字段如安全组）
  const fullConfigRef = useRef<unknown>(null);
  const baseConfigRef = useRef<unknown>(null); // original config snapshot for change tracking
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactFlowInstance = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { takeSnapshot, undo, redo, canUndo, canRedo, reset } = useUndoRedo([], []);

  // Auto-save to localStorage
  const STORAGE_KEY = 'nv-saved-config';
  useEffect(() => {
    if (!config) return;
    try {
      const data = fullConfigRef.current || config;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* quota exceeded or unavailable */ }
  }, [config]);

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && !config) {
        const parsed = JSON.parse(saved);
        fullConfigRef.current = parsed;
        baseConfigRef.current = JSON.parse(saved); // deep clone for diff
        const networkConfig = parsed as NetworkConfig;
        setConfig(networkConfig);
        setShowUpload(false);
        syncJsonText(parsed);
        const msgs = validateNetworkConfig(networkConfig, lang);
        setValidationMessages(msgs);
        setShowValidation(msgs.some(m => m.level === 'error' || m.level === 'warning'));
        const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, 'detailed');
        setNodes(parsedNodes as Node[]);
        setEdges(parsedEdges as Edge[]);
        reset(parsedNodes as Node[], parsedEdges as Edge[]);
        setTimeout(() => { reactFlowInstance.current?.fitView({ padding: 0.1 }); }, 200);
      }
    } catch { /* corrupted storage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Change tracking: compute diff between base and current config + overlay resources
  const changeLog = useMemo(() => {
    const entries: ChangeLogEntry[] = [];
    if (config) {
      const base = baseConfigRef.current as Record<string, unknown> | null;
      if (base) {
        entries.push(...computeChanges(base as NetworkConfig, config));
      }
    }
    // Overlay resources are always "added" (manual operations)
    overlayStore.resources.forEach(r => {
      const cfg = r.config as unknown as Record<string, string>;
      const typeLabel = r.type === 'vpn' ? 'Site-to-Site VPN'
        : r.type === 'cgw' ? 'Customer Gateway'
        : r.type === 'vgw' ? 'Virtual Private GW'
        : r.type === 'privatelink' ? 'PrivateLink'
        : r.type.toUpperCase();
      entries.push({
        type: 'added',
        kind: typeLabel,
        name: cfg.name || r.type,
        jsonPath: r.id, // overlay ID used for focus
        source: 'overlay',
      });
    });
    return entries;
  }, [config, overlayStore.resources]);

  const parseConfig = useCallback((networkConfig: NetworkConfig, mode: ViewMode) => {
    if (mode === 'simplified') {
      return parseNetworkConfigSimplified(networkConfig);
    }
    return parseNetworkConfig(networkConfig);
  }, []);

  // 同步 config → jsonText
  const syncJsonText = useCallback((cfg: unknown) => {
    setJsonText(JSON.stringify(cfg, null, 2));
  }, []);

  // 应用配置并刷新可视化
  const applyConfig = useCallback((networkConfig: NetworkConfig, fullObj?: unknown) => {
    fullConfigRef.current = fullObj || networkConfig;
    setConfig(networkConfig);
    syncJsonText(fullConfigRef.current);

    const msgs = validateNetworkConfig(networkConfig, lang);
    setValidationMessages(msgs);
    if (msgs.some(m => m.level === 'error' || m.level === 'warning')) {
      setShowValidation(true);
    } else {
      setShowValidation(false);
    }

    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);

    setTimeout(() => {
      reactFlowInstance.current?.fitView({ padding: 0.1 });
    }, 100);
  }, [parseConfig, viewMode, setNodes, setEdges, reset, syncJsonText, lang]);

  // Overlay nodes/edges — merge into canvas when overlay resources change
  useEffect(() => {
    if (!config || overlayStore.resources.length === 0) return;
    const baseNodes = nodes.filter(n => !n.id.startsWith('overlay-'));
    const baseEdges = edges.filter(e => !e.id.startsWith('overlay-'));
    const { nodes: overlayNodes, edges: overlayEdges } = renderOverlayResources(
      overlayStore.resources, baseNodes, overlayStore.selectedOverlayId
    );
    setNodes([...baseNodes, ...overlayNodes] as Node[]);
    setEdges([...baseEdges, ...overlayEdges] as Edge[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayStore.resources, overlayStore.selectedOverlayId]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          const state = redo();
          if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
        } else {
          e.preventDefault();
          const state = undo();
          if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        const state = redo();
        if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, setNodes, setEdges]);

  // 文件加载
  const handleFileLoad = useCallback((newConfig: unknown) => {
    const networkConfig = newConfig as NetworkConfig;
    baseConfigRef.current = JSON.parse(JSON.stringify(newConfig)); // snapshot for change tracking
    setShowUpload(false);
    applyConfig(networkConfig, newConfig);
  }, [applyConfig]);

  // 编辑器文本应用
  const handleEditorApply = useCallback((text: string): string | null => {
    try {
      const parsed = JSON.parse(text);
      const networkConfig = parsed as NetworkConfig;
      fullConfigRef.current = parsed;
      setConfig(networkConfig);
      setJsonText(text);

      const msgs = validateNetworkConfig(networkConfig, lang);
      setValidationMessages(msgs);
      setShowValidation(msgs.some(m => m.level === 'error' || m.level === 'warning'));

      const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(networkConfig, viewMode);
      setNodes(parsedNodes as Node[]);
      setEdges(parsedEdges as Edge[]);
      reset(parsedNodes as Node[], parsedEdges as Edge[]);

      setTimeout(() => {
        reactFlowInstance.current?.fitView({ padding: 0.1 });
      }, 100);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [parseConfig, viewMode, setNodes, setEdges, reset, lang]);

  // 下载完整 JSON（包含未可视化字段）
  const handleDownload = useCallback(() => {
    const data = fullConfigRef.current || config;
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const handleExportSvg = useCallback(() => {
    const el = document.querySelector('.react-flow') as HTMLElement;
    if (!el) return;
    // Hide controls/minimap for clean export
    const controls = el.querySelectorAll('.react-flow__controls, .react-flow__minimap');
    controls.forEach(c => (c as HTMLElement).style.display = 'none');
    toSvg(el, {
      filter: (node) => {
        // Exclude interactive overlays
        if (node instanceof HTMLElement) {
          const cls = node.className || '';
          if (typeof cls === 'string' && (cls.includes('react-flow__controls') || cls.includes('react-flow__minimap'))) return false;
        }
        return true;
      },
      backgroundColor: '#0f172a',
    }).then((dataUrl) => {
      controls.forEach(c => (c as HTMLElement).style.display = '');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `network-${viewMode === 'simplified' ? 'topology' : 'detailed'}.svg`;
      a.click();
    }).catch(() => {
      controls.forEach(c => (c as HTMLElement).style.display = '');
      alert(t('SVG 导出失败', 'SVG export failed'));
    });
  }, [viewMode, t]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          handleFileLoad(json);
        } catch {
          alert('Invalid JSON file');
        }
      };
      reader.readAsText(file);
    }
  }, [handleFileLoad]);

  const handleRefresh = useCallback(() => {
    if (sourceFile) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          handleFileLoad(json);
        } catch {
          alert(t('刷新失败：无法解析 JSON 文件', 'Refresh failed: unable to parse JSON'));
        }
      };
      reader.readAsText(sourceFile);
    } else if (config) {
      applyConfig(config, fullConfigRef.current);
    }
  }, [sourceFile, config, handleFileLoad, applyConfig]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    if (mode === viewMode || !config) return;
    setViewMode(mode);
    const { nodes: parsedNodes, edges: parsedEdges } = parseConfig(config, mode);
    setNodes(parsedNodes as Node[]);
    setEdges(parsedEdges as Edge[]);
    reset(parsedNodes as Node[], parsedEdges as Edge[]);
    setTimeout(() => { reactFlowInstance.current?.fitView({ padding: 0.1 }); }, 100);
  }, [viewMode, config, parseConfig, setNodes, setEdges, reset]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleNodeDragStop = useCallback((_: any, __: any, allNodes: Node[]) => {
    takeSnapshot(allNodes, edges as Edge[]);
  }, [takeSnapshot, edges]);

  const handleUndo = useCallback(() => {
    const state = undo();
    if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const state = redo();
    if (state) { setNodes(state.nodes as Node[]); setEdges(state.edges as Edge[]); }
  }, [redo, setNodes, setEdges]);

  // Focus canvas on a node matching a jsonPath
  const focusNodeByPath = useCallback((jsonPath: string) => {
    const rf = reactFlowInstance.current;
    if (!rf) return;
    const allNodes = rf.getNodes() as Node[];
    const target = allNodes.find((n: Node) => (n.data as Record<string, unknown>)?.jsonPath === jsonPath);
    if (!target) return;
    // Get node center in flow coordinates
    const w = (target.style?.width as number) || (target.measured?.width) || 200;
    const h = (target.style?.height as number) || (target.measured?.height) || 100;
    const cx = (target.position?.x ?? 0) + w / 2;
    const cy = (target.position?.y ?? 0) + h / 2;
    // For child nodes, add parent position
    let offsetX = 0, offsetY = 0;
    if (target.parentId) {
      const parent = allNodes.find((n: Node) => n.id === target.parentId);
      if (parent) {
        offsetX = parent.position?.x ?? 0;
        offsetY = parent.position?.y ?? 0;
        if (parent.parentId) {
          const grandparent = allNodes.find((n: Node) => n.id === parent.parentId);
          if (grandparent) {
            offsetX += grandparent.position?.x ?? 0;
            offsetY += grandparent.position?.y ?? 0;
          }
        }
      }
    }
    rf.setCenter(cx + offsetX, cy + offsetY, { zoom: rf.getZoom(), duration: 400 });
    // Trigger highlight animation
    setHighlightedNodeId(target.id);
    setTimeout(() => setHighlightedNodeId(null), 1200);
  }, []);

  // Focus canvas on a node by its ID (for overlay nodes)
  const focusNodeById = useCallback((nodeId: string) => {
    const rf = reactFlowInstance.current;
    if (!rf) return;
    const allNodes = rf.getNodes() as Node[];
    const target = allNodes.find((n: Node) => n.id === nodeId);
    if (!target) return;
    const w = (target.style?.width as number) || (target.measured?.width) || 180;
    const h = (target.style?.height as number) || (target.measured?.height) || 80;
    const cx = (target.position?.x ?? 0) + w / 2;
    const cy = (target.position?.y ?? 0) + h / 2;
    rf.setCenter(cx, cy, { zoom: rf.getZoom(), duration: 400 });
    setHighlightedNodeId(target.id);
    setTimeout(() => setHighlightedNodeId(null), 1200);
  }, []);

  // 节点点击 → 联动编辑器
  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const jp = (node.data as Record<string, unknown>)?.jsonPath as string | undefined;
    if (jp) {
      setSelectedPath(jp);
      // 如果编辑器未打开，自动打开
      if (!editorOpen) {
        setEditorOpen(true);
      }
    }
  }, [editorOpen]);

  // 画布空白处点击 → 清除选中 + 收起编辑器 + 清除路径高亮
  const handlePaneClick = useCallback(() => {
    setSelectedPath(null);
    setEditorOpen(false);
    setHighlightedPath(null);
  }, []);

  // Reachability path highlighting
  const handleHighlightPath = useCallback((result: ReachabilityResult) => {
    setHighlightedPath({
      nodeIds: new Set(result.nodeIds),
      edgeIds: new Set(result.edgeIds),
      sourceId: result.sourceId,
      destId: result.destId,
    });
  }, []);

  const handleClearHighlight = useCallback(() => {
    setHighlightedPath(null);
  }, []);

  const handleConfigUpdate = useCallback((newConfig: NetworkConfig) => {
    applyConfig(newConfig, newConfig);
  }, [applyConfig]);

  // Search: select a node by ID and jsonPath
  const handleSearchSelect = useCallback((nodeId: string, jsonPath: string) => {
    setSelectedPath(jsonPath);
    focusNodeById(nodeId);
  }, [focusNodeById]);

  // Diff: compare against uploaded base OR initial snapshot
  const handleDiffFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as NetworkConfig;
        setDiffBaseConfig(parsed);
        setShowDiff(true);
      } catch { /* invalid json */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleDiffToggle = useCallback(() => {
    if (showDiff) {
      setShowDiff(false);
    } else {
      // If no explicit diff base and no changes from initial load, prompt file upload
      const base = diffBaseConfig || (baseConfigRef.current as NetworkConfig | null);
      if (base && config && JSON.stringify(base) !== JSON.stringify(config)) {
        setShowDiff(true);
      } else {
        // Upload a file to compare against
        diffFileRef.current?.click();
      }
    }
  }, [showDiff, diffBaseConfig, config]);

  const handleDiffUpload = useCallback(() => {
    diffFileRef.current?.click();
  }, []);

  const diffChanges = useMemo(() => {
    if (!showDiff || !config) return null;
    const base = diffBaseConfig || (baseConfigRef.current as NetworkConfig | null);
    if (!base) return null;
    return computeChanges(base as NetworkConfig, config);
  }, [showDiff, config, diffBaseConfig]);

  return (
    <div className="network-flow">
      <Toolbar
        onUpload={handleUploadClick}
        onEdit={() => setEditorOpen(!editorOpen)}
        onDownload={handleDownload}
        onExportSvg={handleExportSvg}
        onRefresh={handleRefresh}
        onZoomIn={() => reactFlowInstance.current?.zoomIn()}
        onZoomOut={() => reactFlowInstance.current?.zoomOut()}
        onFitView={() => reactFlowInstance.current?.fitView({ padding: 0.1 })}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        hasConfig={!!config}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        editorOpen={editorOpen}
        config={config}
        onCollapseAllTables={() => {
          setNodes(ns => ns.map(n => n.type === 'tgw' ? { ...n, data: { ...n.data, collapseSignal: Date.now() } } : n));
        }}
        onExpandAllTables={() => {
          setNodes(ns => ns.map(n => n.type === 'tgw' ? { ...n, data: { ...n.data, collapseSignal: -Date.now() } } : n));
        }}
        onSearchSelect={handleSearchSelect}
        showDiff={showDiff}
        onDiffToggle={handleDiffToggle}
        onDiffUpload={handleDiffUpload}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileSelect}
        hidden
        id="file-upload-input"
        name="file-upload"
      />

      {/* 左侧 JSON 编辑器面板 */}
      {config && (
        <JsonEditorPanel
          jsonText={jsonText}
          selectedPath={selectedPath}
          onApply={handleEditorApply}
          isOpen={editorOpen}
          onToggle={() => setEditorOpen(!editorOpen)}
        />
      )}

      <ResourceManager
        config={config}
        onConfigUpdate={handleConfigUpdate}
        selectedPath={selectedPath}
        onSelectPath={(path) => {
          if (path?.startsWith('overlay-')) {
            // Overlay node: focus by ID, select in overlay store
            overlayStore.selectOverlay(path);
            focusNodeById(path);
          } else {
            setSelectedPath(path);
            if (path && !editorOpen) setEditorOpen(true);
            if (path) focusNodeByPath(path);
          }
        }}
        onFocusOverlay={focusNodeById}
        overlayStore={overlayStore}
        changeLog={changeLog}
        onHighlightPath={handleHighlightPath}
        onClearHighlight={handleClearHighlight}
      />

      {showUpload && !config ? (
        <FileUpload onFileLoad={handleFileLoad} />
      ) : (
        <div className="react-flow-wrapper">
          <ReactFlow
            nodes={(() => {
              let mapped = nodes;
              // Diff view overlay
              if (diffChanges && diffChanges.length > 0) {
                const diffMap = new Map<string, 'added' | 'removed' | 'modified'>();
                diffChanges.forEach(c => {
                  // Map jsonPath to possible node IDs
                  const jp = c.jsonPath;
                  if (c.kind === 'VPC') {
                    const parts = jp.split('.');
                    const vpcName = parts[parts.length - 1];
                    const regionId = parts.length > 2 ? parts[0] : 'main';
                    diffMap.set(`${regionId}-${vpcName}`, c.type);
                  } else if (c.kind === 'TGW') {
                    const regionId = jp.startsWith('tgw') ? 'main' : jp.split('.')[0];
                    diffMap.set(`${regionId}-tgw`, c.type);
                  }
                });
                mapped = mapped.map(n => {
                  const dt = diffMap.get(n.id);
                  if (dt) return { ...n, className: `${n.className || ''} diff-${dt}`.trim() };
                  return n;
                });
              }
              // Path highlighting
              if (highlightedPath) {
                return mapped.map(n => {
                  if (n.id === highlightedPath.sourceId) return { ...n, className: `${n.className || ''} path-source`.trim() };
                  if (n.id === highlightedPath.destId) return { ...n, className: `${n.className || ''} path-dest`.trim() };
                  if (highlightedPath.nodeIds.has(n.id)) return { ...n, className: `${n.className || ''} path-hop`.trim() };
                  if (n.type === 'topoRegionLabel' || n.type === 'region') return n;
                  return { ...n, style: { ...n.style, opacity: 0.25 } };
                });
              }
              if (highlightedNodeId) {
                return mapped.map(n => n.id === highlightedNodeId
                  ? { ...n, className: `${n.className || ''} node-highlight`.trim() }
                  : n);
              }
              return mapped;
            })()}
            edges={
              highlightedPath
                ? edges.map(e => {
                    if (highlightedPath.edgeIds.has(e.id)) {
                      return {
                        ...e,
                        style: {
                          stroke: '#22c55e', strokeWidth: 4,
                          filter: 'drop-shadow(0 0 8px rgba(34,197,94,0.6))',
                          strokeDasharray: '12,12',
                          animation: 'pathFlow 0.6s linear infinite',
                        },
                        animated: false,
                        zIndex: 1000,
                        className: 'path-flow-edge',
                      };
                    }
                    return { ...e, style: { ...e.style, opacity: 0.12 }, animated: false };
                  })
                : edges
            }
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              reactFlowInstance.current = instance;
              instance.fitView({ padding: 0.1 });
            }}
            fitView
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#334155" gap={20} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                if (node.type === 'vpc' || node.type === 'topoVpc') return '#4ECDC4';
                if (node.type === 'tgw' || node.type === 'topoTgw') return '#F59E0B';
                if (node.type === 'region' || node.type === 'topoRegionLabel') return '#3B82F6';
                if (node.type === 'az') return '#475569';
                if (node.type === 'topoAccount') return '#60a5fa';
                if (node.type === 'topoComponent') return '#22c55e';
                if (node.type === 'topoEndpoint') return '#8b5cf6';
                if (node.type === 'topoDx') return '#f97316';
                return '#6B7280';
              }}
              maskColor="rgba(15, 23, 42, 0.8)"
            />
          </ReactFlow>
        </div>
      )}

      {/* Diff file input (hidden) */}
      <input
        ref={diffFileRef}
        type="file"
        accept=".json,application/json"
        onChange={handleDiffFileSelect}
        hidden
        id="diff-file-input"
        name="diff-file"
      />

      {showValidation && validationMessages.length > 0 && (
        <div className="validation-panel">
          <div className="validation-header">
            <span>{t('配置校验', 'Validation')}</span>
            <span className="validation-counts">
              {validationMessages.filter(m => m.level === 'error').length > 0 && (
                <span className="count-error">{validationMessages.filter(m => m.level === 'error').length} {t('错误', 'errors')}</span>
              )}
              {validationMessages.filter(m => m.level === 'warning').length > 0 && (
                <span className="count-warning">{validationMessages.filter(m => m.level === 'warning').length} {t('警告', 'warnings')}</span>
              )}
              {validationMessages.filter(m => m.level === 'info').length > 0 && (
                <span className="count-info">{validationMessages.filter(m => m.level === 'info').length} {t('提示', 'info')}</span>
              )}
            </span>
            <button className="validation-close" onClick={() => setShowValidation(false)}>✕</button>
          </div>
          <div className="validation-list">
            {validationMessages.map((msg, i) => (
              <div key={i} className={`validation-item validation-${msg.level}`}>
                <span className="validation-icon">
                  {msg.level === 'error' ? '✗' : msg.level === 'warning' ? '⚠' : 'ℹ'}
                </span>
                <div className="validation-content">
                  <span className="validation-path">{msg.path}</span>
                  <span className="validation-msg">{msg.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NetworkFlow() {
  return (
    <ReactFlowProvider>
      <NetworkFlowInner />
    </ReactFlowProvider>
  );
}
