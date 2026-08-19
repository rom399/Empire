/**
 * What a validate()-wrapped handler receives instead of raw ctx access -
 * each field is the schema's inferred output type, or undefined for
 * whichever of body/query/params wasn't given a schema.
 */
export interface Validated<TBody, TQuery, TParams> {
    body: TBody;
    query: TQuery;
    params: TParams;
}
