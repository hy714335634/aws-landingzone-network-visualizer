import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Wifi, Router, Server, Link2 } from 'lucide-react';

// Helper to safely extract typed data fields from unknown node data
function d(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return v != null ? String(v) : '';
}

// ============================================
// VPN Node
// ============================================
export const VpnNode = memo(({ data, selected }: NodeProps) => {
  const nd = data as Record<string, unknown>;
  return (
    <div className={`overlay-node vpn-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon vpn"><Wifi size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d(nd, 'label')}</div>
        <div className="overlay-node-meta">
          {nd.tunnels != null && <span>{d(nd, 'tunnels')} 隧道</span>}
          {nd.routingType != null && <span>{nd.routingType === 'bgp' ? 'BGP' : 'Static'}</span>}
        </div>
        {Array.isArray(nd.insideCidrs) && (
          <div className="overlay-node-cidrs">
            {(nd.insideCidrs as string[]).map((c: string, i: number) => (
              <span key={i} className="overlay-cidr">{c}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================
// Customer Gateway Node
// ============================================
export const CgwNode = memo(({ data, selected }: NodeProps) => {
  const nd = data as Record<string, unknown>;
  return (
    <div className={`overlay-node cgw-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon cgw"><Router size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d(nd, 'label')}</div>
        <div className="overlay-node-meta">
          {nd.bgpAsn != null && <span>ASN {d(nd, 'bgpAsn')}</span>}
          {nd.ipAddress != null && <span className="overlay-cidr">{d(nd, 'ipAddress')}</span>}
        </div>
      </div>
    </div>
  );
});

// ============================================
// Virtual Private Gateway Node
// ============================================
export const VgwNode = memo(({ data, selected }: NodeProps) => {
  const nd = data as Record<string, unknown>;
  return (
    <div className={`overlay-node vgw-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon vgw"><Server size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d(nd, 'label')}</div>
        <div className="overlay-node-meta">
          {nd.asn != null && <span>ASN {d(nd, 'asn')}</span>}
          <span>VGW</span>
        </div>
      </div>
    </div>
  );
});

// ============================================
// PrivateLink Node
// ============================================
export const PrivateLinkNode = memo(({ data, selected }: NodeProps) => {
  const nd = data as Record<string, unknown>;
  return (
    <div className={`overlay-node pl-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon pl"><Link2 size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d(nd, 'label')}</div>
        <div className="overlay-node-meta">
          {nd.serviceName != null && <span className="overlay-cidr">{d(nd, 'serviceName')}</span>}
        </div>
      </div>
    </div>
  );
});
