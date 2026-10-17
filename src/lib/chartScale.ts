// A nice step for a value axis: 1, 2, 2.5 or 5 times a power of
// ten. The shared definition for the charts' y-axis scales - the
// solar production chart established it and the gas and battery
// charts follow.
export function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))))
  const factor = raw / power
  const nice = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10
  return nice * power
}
