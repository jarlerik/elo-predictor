import express from "express";
import path from "path";
import fs from "fs";
import routes from "./routes";

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

// Check if client build exists
const clientBuildPath = path.join(process.cwd(), "dist/client");
const clientIndexPath = path.join(clientBuildPath, "index.html");
const isProduction = process.env.NODE_ENV === "production";

// Serve static files from the client build (only if it exists)
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
}

// API routes
app.use("/api", routes);

// Serve the React app for all non-API routes (only in production or if build exists)
if (isProduction || fs.existsSync(clientIndexPath)) {
  app.get("*", (req, res) => {
    res.sendFile(clientIndexPath);
  });
} else {
  // In development, redirect to Vite dev server (but not for API routes)
  app.get("*", (req, res) => {
    // Don't redirect API routes
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "API route not found" });
    }
    res.redirect("http://localhost:3001");
  });
}

app.listen(port, () => {
  console.log(`NHL ELO Predictor running on http://localhost:${port}`);
  if (!isProduction && !fs.existsSync(clientIndexPath)) {
    console.log(`Frontend dev server: http://localhost:3001`);
    console.log(
      `Note: Run 'npm run build:client' to build the frontend for production`
    );
  }
});
