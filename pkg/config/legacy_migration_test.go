package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyFilesDirectoryFailurePreservesAllFiles(t *testing.T) {
	for _, blockedDir := range []string{"journals", "daemon"} {
		t.Run(blockedDir, func(t *testing.T) {
			home := t.TempDir()
			cwd := t.TempDir()
			t.Setenv("HOME", home)
			t.Setenv("USERPROFILE", home)
			previous, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chdir(cwd); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := os.Chdir(previous); err != nil {
					t.Errorf("restore cwd: %v", err)
				}
			})

			geltDir := filepath.Join(home, ".gelt")
			if err := os.MkdirAll(geltDir, 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(geltDir, blockedDir), []byte("directory obstruction"), 0600); err != nil {
				t.Fatal(err)
			}
			legacy := map[string][]byte{
				"gelt_shadow_journal.json": []byte("shadow bytes"),
				"gelt_ai_theses.json":      []byte("thesis bytes"),
				"gelt_journal.json":        []byte("journal bytes"),
				"gelt_daemon_status.json":  []byte("daemon bytes"),
				"gelt_mcp.json":            []byte("mcp bytes"),
			}
			for name, contents := range legacy {
				if err := os.WriteFile(filepath.Join(geltDir, name), contents, 0600); err != nil {
					t.Fatal(err)
				}
			}

			MigrateLegacyFiles()

			for name, want := range legacy {
				got, err := os.ReadFile(filepath.Join(geltDir, name))
				if err != nil || string(got) != string(want) {
					t.Errorf("legacy %s not preserved: got=%q err=%v", name, got, err)
				}
			}
			for _, name := range []string{"shadow_journal.json", "ai_theses.json", "live_journal.json", "status.json"} {
				if _, err := os.Lstat(filepath.Join(cwd, name)); !os.IsNotExist(err) {
					t.Errorf("unexpected cwd destination %s (err=%v)", name, err)
				}
			}
		})
	}
}

func TestMigrateLegacyFilesSuccessfulAndExistingTargetCompatibility(t *testing.T) {
	home := t.TempDir()
	cwd := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(cwd); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Errorf("restore cwd: %v", err)
		}
	})

	geltDir := filepath.Join(home, ".gelt")
	journalsDir := filepath.Join(geltDir, "journals")
	daemonDir := filepath.Join(geltDir, "daemon")
	for _, dir := range []string{journalsDir, daemonDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	legacy := map[string][]byte{
		"gelt_shadow_journal.json": []byte("new shadow bytes"),
		"gelt_ai_theses.json":      []byte("thesis bytes"),
		"gelt_journal.json":        []byte("journal bytes"),
		"gelt_daemon_status.json":  []byte("daemon bytes"),
		"gelt_mcp.json":            []byte("mcp bytes"),
	}
	for name, contents := range legacy {
		if err := os.WriteFile(filepath.Join(geltDir, name), contents, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(journalsDir, "shadow_journal.json"), []byte("existing target"), 0600); err != nil {
		t.Fatal(err)
	}

	MigrateLegacyFiles()

	if got, err := os.ReadFile(filepath.Join(journalsDir, "shadow_journal.json")); err != nil || string(got) != "existing target" {
		t.Fatalf("existing destination changed: got=%q err=%v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(geltDir, "gelt_shadow_journal.json")); err != nil || string(got) != string(legacy["gelt_shadow_journal.json"]) {
		t.Fatalf("legacy with existing target should remain: got=%q err=%v", got, err)
	}
	for _, item := range []struct {
		old, dest string
		want      []byte
	}{
		{"gelt_ai_theses.json", filepath.Join(journalsDir, "ai_theses.json"), legacy["gelt_ai_theses.json"]},
		{"gelt_journal.json", filepath.Join(journalsDir, "live_journal.json"), legacy["gelt_journal.json"]},
		{"gelt_daemon_status.json", filepath.Join(daemonDir, "status.json"), legacy["gelt_daemon_status.json"]},
		{"gelt_mcp.json", filepath.Join(geltDir, "mcp.json"), legacy["gelt_mcp.json"]},
	} {
		got, err := os.ReadFile(item.dest)
		if err != nil || string(got) != string(item.want) {
			t.Errorf("successful mapping %s: got=%q err=%v", item.dest, got, err)
		}
		if _, err := os.Lstat(filepath.Join(geltDir, item.old)); !os.IsNotExist(err) {
			t.Errorf("legacy source %s should be renamed (err=%v)", item.old, err)
		}
	}
	for _, name := range []string{"shadow_journal.json", "ai_theses.json", "live_journal.json", "status.json"} {
		if _, err := os.Lstat(filepath.Join(cwd, name)); !os.IsNotExist(err) {
			t.Errorf("unexpected cwd destination %s (err=%v)", name, err)
		}
	}
}
