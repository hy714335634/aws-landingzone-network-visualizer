import VpcNode from './VpcNode';
import TgwNode from './TgwNode';
import SubnetNode from './SubnetNode';
import SubnetGroupNode from './SubnetGroupNode';
import RegionNode from './RegionNode';
import AzNode from './AzNode';
import TopoVpcNode from './SimpleVpcNode';
import TopoTgwNode from './SimpleTgwNode';
import TopoAccountNode from './TopoAccountNode';
import TopoComponentNode from './TopoComponentNode';
import TopoRegionLabelNode from './TopoRegionLabelNode';

export const nodeTypes = {
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
};

export {
  VpcNode, TgwNode, SubnetNode, SubnetGroupNode, RegionNode, AzNode,
  TopoVpcNode, TopoTgwNode, TopoAccountNode, TopoComponentNode, TopoRegionLabelNode,
};
