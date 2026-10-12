import * as THREE from 'three';
import { solvePosition } from '../robot-kinematics.js';

// Scripted fetch-and-deliver mission; poses are solved against the loaded arm.
export function createMission({ scene, robot, tcp, apply, fingers }) {
  const part = new THREE.Mesh(new THREE.BoxGeometry(.065, .065, .065), new THREE.MeshStandardMaterial({ color: 0xe9b568, roughness: .4, metalness: .2 }));
  part.castShadow = true; scene.add(part);
  const source = new THREE.Vector3(-.8, .56, -.48);
  const destination = new THREE.Vector3(2, .56, -.48);
  const stationPositions = [-1.4, 1.4];
  stationPositions.forEach((x, index) => {
    const table = new THREE.Mesh(new THREE.BoxGeometry(.62, .055, .5), new THREE.MeshStandardMaterial({ color: 0x23394b }));
    table.position.set(x + .6, .5, -.48); scene.add(table);
    for (const dx of [-.24,.24]) for (const dz of [-.18,.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.035,.48,.035), table.material);
      leg.position.set(x+.6+dx,.24,-.48+dz); scene.add(leg);
    }
    const pad = new THREE.Mesh(new THREE.RingGeometry(.1,.115,48),new THREE.MeshBasicMaterial({color:index ? 0x65d9ff : 0xe9b568,side:THREE.DoubleSide}));
    pad.rotation.x=-Math.PI/2;pad.position.set(x+.6,.53,-.48);scene.add(pad);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
    const context=canvas.getContext('2d');context.fillStyle='#101e2e';context.fillRect(0,0,256,64);context.fillStyle=index?'#65d9ff':'#e9b568';context.font='22px monospace';context.fillText(index?'B / DELIVERY':'A / PICKUP',18,40);
    const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas)}));sign.position.set(x+.6,.87,-.7);sign.scale.set(.7,.175,1);scene.add(sign);
  });
  const route = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.4,.012,0),new THREE.Vector3(-1.1,.012,0),new THREE.Vector3(-.5,.012,.7),new THREE.Vector3(.6,.012,.7),new THREE.Vector3(1.1,.012,0),new THREE.Vector3(1.4,.012,0)
  ]);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(route.getPoints(100)),new THREE.LineDashedMaterial({color:0x65d9ff,dashSize:.09,gapSize:.06})).computeLineDistances());
  const obstacle=new THREE.Mesh(new THREE.BoxGeometry(.35,.25,.32),new THREE.MeshStandardMaterial({color:0x745944}));obstacle.position.set(0,.125,-.1);scene.add(obstacle);
  let home={shoulder:0,upper:-1.2,fore:1.9,wrist1:.5,wrist2:1.57,wrist3:0};
  const keys=Object.keys(home);
  const position=()=>{robot.updateWorldMatrix(true,true);return tcp.getWorldPosition(new THREE.Vector3());};
  robot.position.set(0,.16,0);robot.rotation.y=0;
  home=solvePosition({joints:keys,values:home,apply,position,target:new THREE.Vector3(.5,.9,0),iterations:220});
  const poses=[];
  stationPositions.forEach((x,i)=>{
    robot.position.set(x,.16,0);robot.rotation.y=0;
    const goal=(i?destination:source).clone().add(new THREE.Vector3(0,.015,0));
    const above=goal.clone().add(new THREE.Vector3(0,.18,0));
    const solve=(target,values)=>solvePosition({joints:keys,values,apply,position,target,iterations:180});
    const approach=solve(above,home), grasp=solve(goal,approach);
    poses.push({approach,grasp});
  });
  robot.position.set(1.4,.16,0);apply(home);
  let previousPosition=robot.position.clone();
  const mix=(a,b,t)=>{const q={};keys.forEach(k=>q[k]=a[k]+(b[k]-a[k])*t);apply(q);};
  const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const segments=[
    [0,6,'01 / Navigate to pickup'],[6,8,'02 / Dock & stabilize'],[8,10,'03 / Approach the part'],[10,11,'04 / Close gripper'],[11,13,'05 / Lift clear'],[13,15,'06 / Stow for transport'],[15,22,'07 / Navigate around obstacle'],[22,24,'08 / Align with delivery station'],[24,26,'09 / Lower onto station B'],[26,27,'10 / Release & verify'],[27,29,'11 / Retract arm'],[29,32,'12 / Mission complete']
  ];
  return {
    update(time) {
      const t=time%32, stage=segments.findIndex(([,end])=>t<end), [start,end,status]=segments[stage];
      const u=ease((t-start)/(end-start));
      let open=.4, held=t>=10.8&&t<26.7;
      if(t<6||t>=15&&t<22){
        const v=t<6?1-ease(t/6):ease((t-15)/7);const point=route.getPointAt(v);robot.position.set(point.x,.16,point.z);
        const tangent=route.getTangentAt(v);robot.rotation.y=-Math.atan2(tangent.z,tangent.x);apply(home);
      }else{
        const dock=t<15?0:1;robot.position.set(stationPositions[dock],.16,0);
        const tangent=route.getTangentAt(dock);const yaw=-Math.atan2(tangent.z,tangent.x);
        robot.rotation.y=(stage===1||stage===7)?yaw*(1-u):0;
        const pose=poses[dock];
        if(stage===1||stage===7)mix(home,pose.approach,u);
        else if(stage===2||stage===8)mix(pose.approach,pose.grasp,u);
        else if(stage===3){apply(pose.grasp);open=.4*(1-u);}
        else if(stage===4){mix(pose.grasp,pose.approach,u);open=0;}
        else if(stage===5){mix(pose.approach,home,u);open=0;}
        else if(stage===9){apply(pose.grasp);open=.4*u;}
        else if(stage===10)mix(pose.grasp,pose.approach,u);
        else mix(pose.approach,home,u);
      }
      if(held){part.position.copy(position()).add(new THREE.Vector3(0,-.015,0));open=stage===9?open:0;}else part.position.copy(t<10.8?source:destination);
      fingers.left.rotation.z=-open;fingers.right.rotation.z=open;
      const distance=robot.position.distanceTo(previousPosition);previousPosition.copy(robot.position);
      return {status,progress:t/32,distance,moving:t<6||t>=15&&t<22};
    },
    part,
  };
}
