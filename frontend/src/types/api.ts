export interface ApiRequestOptions {
  auth?: boolean;
}

export interface ApiListResponse<T> {
  items: T[];
}
