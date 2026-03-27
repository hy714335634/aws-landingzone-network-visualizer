import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Cloud, Globe, ArrowUpDown, Shield, Server } from 'lucide-react';

interface TopoVpcNodeData {
  label: string;
  cidr: string;
  isHub?: boolean;
  isEndpoint?: boolean;
  hasIgw?: boolean;
  hasNat?: boolean;
  hasNfw?: boolean;
  hasGwlb?: boolean;
}

const TopoVpcNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoVpcNodeData;
  const comps: { key: string; icon: typeof Globe; label: string; cls: string }[] = [];
  if (d.hasIgw) comps.push({ key: 'igw', icon: Globe, label: 'IGW', cls: 'igw' });
  if (d.hasNat) comps.push({ key: 'nat', icon: ArrowUpDown, label: 'NAT', cls: 'nat' });
  if (d.hasNfw) comps.push({ key: 'nfw', icon: Shield, label: 'NFW', cls: 'nfw' });
  if (d.hasGwlb) comps.push({ key: 'gwlb', icon: Server, label: 'GWLB', cls: 'gwlb' });

  return (
    <div className={`topo-vpc ${d.isHub ? 'is-hub' : ''} ${d.isEndpoint ? 'is-endpoint' : ''}`}>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Top} id="source-top" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <div className="topo-vpc-row">
        <Cloud size={13} />
        <span className="topo-vpc-name">{d.label.toUpperCase()}</span>
        {d.isHub && <span className="topo-badge hub">HUB</span>}
        {d.isEndpoint && <span className="topo-badge ep">EP</span>}
      </div>
      <div className="topo-vpc-cidr">{d.cidr}</div>
      {comps.length > 0 && (
        <div className="topo-vpc-comps">
          {comps.map(c => (
            <span key={c.key} className={`topo-comp-inline ${c.cls}`}>
              <c.icon size={9} /> {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

TopoVpcNode.displayName = 'TopoVpcNode';
export default TopoVpcNode;
