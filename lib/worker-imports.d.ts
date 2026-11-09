/** Vite compiles ?worker imports into constructors with bundled browser URLs. */
declare module "*?worker" {
  const WorkerConstructor:new(options?:WorkerOptions)=>Worker;
  export default WorkerConstructor;
}
