// Placeholder: replaced by the ocean world (terrain, water, light, camera, day/night clock).
export function OceanBiome() {
  return (
    <>
      <color attach="background" args={['#0b3b5a']} />
      <fog attach="fog" args={['#0b3b5a', 10, 90]} />
      <hemisphereLight args={['#bfe8ff', '#36506a', 1.2]} />
      <directionalLight position={[10, 30, 5]} intensity={1.5} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[240, 240]} />
        <meshLambertMaterial color="#d9c79a" />
      </mesh>
    </>
  );
}
