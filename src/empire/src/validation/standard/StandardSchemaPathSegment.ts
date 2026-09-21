/** A path step written as an object, which some validators use instead of a bare key. */
export interface StandardSchemaPathSegment {
    readonly key: PropertyKey;
}
