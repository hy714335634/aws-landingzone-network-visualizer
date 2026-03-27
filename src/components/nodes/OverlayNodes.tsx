import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Wifi, Router, Server, Link2 } from 'lucide-react';

// ============================================
// VPN Node
// ============================================
export const VpnNode = memo(({ data, selected }: NodeProps) => {
  const d = data as Record<string, unknown>;
  return (
    <div className={`overlay-node vpn-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon vpn"><Wifi size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d.label as string}</div>
        <div className="overlay-node-meta">
          {d.tunnels && <span>{d.tunnels as number} 隧道</span>}
          {d.routingType && <span>{d.routingType as string === 'bgp' ? 'BGP' : 'Static'}</span>}
        </div>
        {d.insideCidrs && (
          <div className="overlay-node-cidrs">
            {(d.insideCidrs as string[]).map((c, i) => (
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
  const d = data as Record<string, unknown>;
  return (
    <div className={`overlay-node cgw-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon cgw"><Router size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d.label as string}</div>
        <div className="overlay-node-meta">
          {d.bgpAsn && <span>ASN {d.bgpAsn as number}</span>}
          {d.ipAddress && <span className="overlay-cidr">{d.ipAddress as string}</span>}
        </div>
      </div>
    </div>
  );
});

// ============================================
// Virtual Private Gateway Node
// ============================================
export const VgwNode = memo(({ data, selected }: NodeProps) => {
  const d = data as Record<string, unknown>;
  return (
    <div className={`overlay-node vgw-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon vgw"><Server size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d.label as string}</div>
        <div className="overlay-node-meta">
          {d.asn && <span>ASN {d.asn as number}</span>}
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
  const d = data as Record<string, unknown>;
  return (
    <div className={`overlay-node pl-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <div className="overlay-node-icon pl"><Link2 size={16} /></div>
      <div className="overlay-node-body">
        <div className="overlay-node-title">{d.label as string}</div>
        <div className="overlay-node-meta">
          {d.serviceName && <span className="overlay-cidr">{d.serviceName as string}</span>}
        </div>
      </div>
    </div>
  );
});
