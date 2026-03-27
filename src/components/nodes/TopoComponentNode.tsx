import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Globe, ArrowUpDown, Shield, Server } from 'lucide-react';

interface TopoComponentNodeData {
  compType: 'igw' | 'nat' | 'nfw' | 'gwlb';
}

const COMP_CONFIG: Record<string, { icon: typeof Globe; label: string }> = {
  igw:  { icon: Globe, label: 'IGW' },
  nat:  { icon: ArrowUpDown, label: 'NAT' },
  nfw:  { icon: Shield, label: 'NFW' },
  gwlb: { icon: Server, label: 'GWLB' },
};

const TopoComponentNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as TopoComponentNodeData;
  const cfg = COMP_CONFIG[d.compType] || COMP_CONFIG.igw;
  const Icon = cfg.icon;
  return (
    <div className={`topo-comp topo-comp-${d.compType}`}>
      <Handle type="target" position={Position.Top} id="target-top" />
      <Handle type="source" position={Position.Top} id="source-top" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Icon size={11} />
      <span>{cfg.label}</span>
    </div>
  );
});

TopoComponentNode.displayName = 'TopoComponentNode';
export default TopoComponentNode;
