// Metro resolves image imports to bundled asset references.
declare module "*.png" {
  const source: import("react-native").ImageSourcePropType;
  export default source;
}

declare module "*.jpg" {
  const source: import("react-native").ImageSourcePropType;
  export default source;
}
