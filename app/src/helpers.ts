export function sumObj(obj: any): number {
  const arr: number[] = Object.values(obj);
  return sumArr(arr);
}

export function sumArr(arr: number[]): number {
  const sum: number = arr.reduce((p, c) => p + c, 0);
  return sum;
}
