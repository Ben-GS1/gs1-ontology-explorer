declare module "@rdfjs/dataset" {
  import type { Quad } from "n3";

  interface DatasetCoreLike extends Iterable<Quad> {
    readonly size: number;
    add(quad: Quad): this;
    delete(quad: Quad): this;
    has(quad: Quad): boolean;
    match(subject?: unknown, predicate?: unknown, object?: unknown, graph?: unknown): DatasetCoreLike;
  }

  interface DatasetFactory {
    dataset(quads?: Iterable<Quad>): DatasetCoreLike;
  }

  const factory: DatasetFactory;
  export default factory;
}
