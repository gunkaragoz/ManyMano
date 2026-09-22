import { flatRoutes } from "@react-router/fs-routes";

// File-based routing, same convention as before (app/routes/*).
// flatRoutes() defaults resolve relative to the app directory, so this
// file preserves every existing route id (routes/_index, routes/events.$id, …).
export default flatRoutes();
