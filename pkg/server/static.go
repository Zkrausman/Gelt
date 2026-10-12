package server

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web/*
var webFS embed.FS

// getFileSystem returns a sub-filesystem for the web directory.
func getFileSystem() http.FileSystem {
	fsys, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	return http.FS(fsys)
}

func (s *TelemetryServer) serveStaticFiles() {
	// Custom handler for root to handle theme switching
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			// For all other files (like static/app.js), serve them normally
			http.FileServer(getFileSystem()).ServeHTTP(w, r)
			return
		}

		theme := r.URL.Query().Get("theme")
		var fileToServe string

		switch theme {
		case "glass":
			fileToServe = "theme_glass.html"
		case "blueprint":
			fileToServe = "theme_blueprint.html"
		case "retro":
			fileToServe = "theme_retro.html"
		case "cyberpunk":
			fileToServe = "theme_cyberpunk.html"
		default:
			// Default to cyberpunk if no theme specified or invalid theme
			fileToServe = "theme_cyberpunk.html"
		}

		content, err := webFS.ReadFile("web/" + fileToServe)
		if err != nil {
			http.Error(w, "Theme file not found", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html")
		w.Write(content)
	})
}
