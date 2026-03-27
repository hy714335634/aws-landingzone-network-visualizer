import type { Node, Edge } from '@xyflow/react';
import type { OverlayResource, VpnConfig, CgwConfig, VgwConfig, PrivateLinkConfig } from '../types/overlay';

/**
 * Compute absolute position for a node (walking up the parent chain).
 */
function absolutePosition(node: Node, nodeMap: Map<string, Node>): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let current = node;
  while (current.parentId) {
    const parent = nodeMap.get(current.parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    current = parent;
  }
  return { x, y };
}

/**
 * Convert overlay resources into ReactFlow nodes and edges.
 * Positions are placed relative to existing nodes in the graph.
 */
export function renderOverlayResources(
  resources: OverlayResource[],
  existingNodes: Node[],
  selectedOverlayId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Build node map for parent chain resolution
  const nodeMap = new Map<string, Node>();
  existingNodes.forEach(n => nodeMap.set(n.id, n));

  // Build absolute position lookup
  const nodePositions = new Map<string, { x: number; y: number; width: number; height: number }>();
  existingNodes.forEach(n => {
    const w = typeof n.style?.width === 'number' ? n.style.width : (n.measured?.width || 160);
    const h = typeof n.style?.height === 'number' ? n.style.height : (n.measured?.height || 60);
    const abs = absolutePosition(n, nodeMap);
    nodePositions.set(n.id, { x: abs.x, y: abs.y, width: w, height: h });
  });

  // Track placement offsets per attachment
  const attachOffsets = new Map<string, number>();
  function getOffset(attachedTo: string): number {
    const current = attachOffsets.get(attachedTo) || 0;
    attachOffsets.set(attachedTo, current + 1);
    return current;
  }

  resources.forEach((resource) => {
    const offset = getOffset(resource.attachedTo);
    const attachPos = nodePositions.get(resource.attachedTo);

    // Default position: below the attached node
    let x = attachPos ? attachPos.x + offset * 200 : offset * 200;
    let y = attachPos ? attachPos.y + attachPos.height + 80 : 400 + offset * 120;

    switch (resource.type) {
      case 'vpn': {
        const cfg = resource.config as VpnConfig;
        nodes.push({
          id: resource.id,
          type: 'overlayVpn',
          position: { x, y },
          data: {
            label: cfg.name,
            tunnels: cfg.tunnels,
            routingType: cfg.routingType,
            insideCidrs: cfg.insideCidrs,
            overlayId: resource.id,
          },
          style: { width: 180, height: 80 },
          selected: resource.id === selectedOverlayId,
        });
        // Edge from TGW to VPN
        edges.push({
          id: `overlay-edge-${resource.id}`,
          source: resource.attachedTo,
          target: resource.id,
          sourceHandle: 'source-bottom',
          targetHandle: 'top',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 2, strokeDasharray: '6,3' },
          label: 'VPN',
          labelStyle: { fill: '#22c55e', fontWeight: 600, fontSize: 10 },
          labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
          labelBgPadding: [4, 3] as [number, number],
          labelBgBorderRadius: 4,
          zIndex: 200,
        });

        // Find associated CGW and create edge
        const cgw = resources.find(r =>
          r.type === 'cgw' && (r.config as CgwConfig).ipAddress === cfg.customerGatewayIp);
        if (cgw) {
          edges.push({
            id: `overlay-vpn-cgw-${resource.id}`,
            source: resource.id,
            target: cgw.id,
            sourceHandle: 'bottom',
            targetHandle: 'top',
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#22c55e', strokeWidth: 2, strokeDasharray: cfg.tunnels === 2 ? '4,2' : '6,3' },
            label: cfg.tunnels === 2 ? '2x IPSec' : 'IPSec',
            labelStyle: { fill: '#22c55e', fontWeight: 600, fontSize: 9 },
            labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
            labelBgPadding: [3, 2] as [number, number],
            labelBgBorderRadius: 3,
            zIndex: 200,
          });
        }
        break;
      }

      case 'cgw': {
        const cfg = resource.config as CgwConfig;
        // Place CGW below VPN nodes
        y += 100;
        nodes.push({
          id: resource.id,
          type: 'overlayCgw',
          position: { x, y },
          data: {
            label: cfg.name,
            bgpAsn: cfg.bgpAsn,
            ipAddress: cfg.ipAddress,
            overlayId: resource.id,
          },
          style: { width: 180, height: 70 },
          selected: resource.id === selectedOverlayId,
        });
        break;
      }

      case 'vgw': {
        const cfg = resource.config as VgwConfig;
        // Place next to the attached VPC
        x = attachPos ? attachPos.x + attachPos.width + 40 : x;
        y = attachPos ? attachPos.y : y;
        nodes.push({
          id: resource.id,
          type: 'overlayVgw',
          position: { x, y },
          data: {
            label: cfg.name,
            asn: cfg.asn,
            overlayId: resource.id,
          },
          style: { width: 160, height: 60 },
          selected: resource.id === selectedOverlayId,
        });
        edges.push({
          id: `overlay-edge-${resource.id}`,
          source: resource.attachedTo,
          target: resource.id,
          sourceHandle: 'source-right',
          targetHandle: 'left',
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '6,3' },
          zIndex: 200,
        });
        break;
      }

      case 'privatelink': {
        const cfg = resource.config as PrivateLinkConfig;
        // Find target VPC position
        const targetKey = `${resource.regionId}-${cfg.targetVpc}`;
        const targetPos = nodePositions.get(targetKey);
        if (targetPos) {
          x = (attachPos ? attachPos.x : 0) + ((targetPos.x - (attachPos?.x || 0)) / 2);
          y = Math.max(attachPos?.y || 0, targetPos.y) - 40;
        }
        nodes.push({
          id: resource.id,
          type: 'overlayPrivateLink',
          position: { x, y },
          data: {
            label: cfg.name,
            serviceName: cfg.serviceName,
            overlayId: resource.id,
          },
          style: { width: 160, height: 50 },
          selected: resource.id === selectedOverlayId,
        });
        // Edges from source to PL, PL to target
        const sourceVpcId = `${resource.regionId}-${cfg.sourceVpc}`;
        const targetVpcId = `${resource.regionId}-${cfg.targetVpc}`;
        edges.push({
          id: `overlay-pl-src-${resource.id}`,
          source: sourceVpcId,
          target: resource.id,
          type: 'smoothstep',
          style: { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '4,3' },
          zIndex: 200,
        });
        edges.push({
          id: `overlay-pl-tgt-${resource.id}`,
          source: resource.id,
          target: targetVpcId,
          type: 'smoothstep',
          style: { stroke: '#3b82f6', strokeWidth: 1.5, strokeDasharray: '4,3' },
          label: 'PrivateLink',
          labelStyle: { fill: '#3b82f6', fontWeight: 600, fontSize: 9 },
          labelBgStyle: { fill: '#1e293b', fillOpacity: 0.9 },
          labelBgPadding: [3, 2] as [number, number],
          labelBgBorderRadius: 3,
          zIndex: 200,
        });
        break;
      }
    }
  });

  return { nodes, edges };
}
