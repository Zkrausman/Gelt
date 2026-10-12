package shadow

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeployment_ServiceBehavior(t *testing.T) {
	// Read the systemd service file
	serviceFile := filepath.Join("..", "..", "deploy", "gelt-shadow.service")
	content, err := os.ReadFile(serviceFile)
	if err != nil {
		t.Fatalf("Failed to read service file: %v", err)
	}

	svcStr := string(content)
	if !strings.Contains(svcStr, "ExecStart=/opt/gelt/bin/linux/gelt shadow daemon") {
		t.Errorf("Service file missing expected ExecStart line")
	}
	if !strings.Contains(svcStr, "Environment=\"GELT_AUTO_SPAWN_ORCHESTRATOR=false\"") {
		t.Errorf("Service file missing GELT_AUTO_SPAWN_ORCHESTRATOR override")
	}
}

func TestDeployment_SetupScript_Validation(t *testing.T) {
	wd, _ := os.Getwd()
	repoRoot := filepath.Join(wd, "..", "..")
	scriptPath := filepath.Join(repoRoot, "deploy", "setup-vm.sh")

	tmpDir := t.TempDir()

	optDir := filepath.Join(tmpDir, "opt")
	homeDir := filepath.Join(tmpDir, "home")
	systemdDir := filepath.Join(tmpDir, "systemd")

	os.MkdirAll(optDir, 0755)
	os.MkdirAll(homeDir, 0755)
	os.MkdirAll(systemdDir, 0755)

	// Create mock binary source
	binDir := filepath.Join(tmpDir, "bin", "linux")
	os.MkdirAll(binDir, 0755)
	mockBin := filepath.Join(binDir, "gelt")
	os.WriteFile(mockBin, []byte("mockbinary"), 0755)

	// Read the real service template into the repo mock so sed works properly
	realSvcPath := filepath.Join(repoRoot, "deploy", "gelt-shadow.service")
	realSvcData, err := os.ReadFile(realSvcPath)
	if err != nil {
		t.Fatalf("Failed to read real service template for mock: %v", err)
	}
	deployDir := filepath.Join(tmpDir, "deploy")
	os.MkdirAll(deployDir, 0755)
	os.WriteFile(filepath.Join(deployDir, "gelt-shadow.service"), realSvcData, 0644)

	// Mock binaries for the script to prevent permission denied errors
	mockBinDir := filepath.Join(tmpDir, "mockbin")
	os.MkdirAll(mockBinDir, 0755)

	createMock := func(name string) {
		p := filepath.Join(mockBinDir, name)
		os.WriteFile(p, []byte("#!/bin/bash\nexit 0\n"), 0755)
	}
	createMock("useradd")
	createMock("chown")
	createMock("systemctl")
	createMock("su")
	createMock("id")

	pStat := filepath.Join(mockBinDir, "stat")
	os.WriteFile(pStat, []byte("#!/bin/bash\necho \"gelt:gelt\"\n"), 0755)

	env := os.Environ()
	pathIdx := -1
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			pathIdx = i
			break
		}
	}
	newPath := "PATH=" + mockBinDir
	if pathIdx != -1 {
		newPath += ":" + strings.TrimPrefix(env[pathIdx], "PATH=")
	}

	// Prepare custom env
	scriptEnv := append(os.Environ(),
		newPath,
		"GELT_OPT_DIR="+filepath.ToSlash(optDir),
		"GELT_HOME_DIR="+filepath.ToSlash(homeDir),
		"SYSTEMD_DIR="+filepath.ToSlash(systemdDir),
	)

	// Function to explicitly check if bash considers a file executable
	isBashExecutable := func(path string) bool {
		err := exec.Command("bash", "-c", "[ -x '"+path+"' ]").Run()
		return err == nil
	}

	setupExecutableFixture := func() string {
		mockBinSlash := filepath.ToSlash(mockBin)
		// Explicit shebang is required on Windows Git Bash for files without .exe to be considered executable
		err := exec.Command("bash", "-c", "echo '#!/bin/bash' > '"+mockBinSlash+"' && echo 'mockbinary' >> '"+mockBinSlash+"' && chmod +x '"+mockBinSlash+"'").Run()
		if err != nil {
			t.Fatalf("Failed to create and chmod +x mockBin via bash: %v", err)
		}

		if !isBashExecutable(mockBinSlash) {
			t.Skip("Shell execution bit cannot be reliably represented on this Windows runner")
		}

		mockBinData, err := os.ReadFile(mockBin)
		if err != nil {
			t.Fatalf("Failed to read mock binary for hashing: %v", err)
		}
		hashBytes := sha256.Sum256(mockBinData)
		return hex.EncodeToString(hashBytes[:])
	}

	setupNonExecutableFixture := func() string {
		mockBinSlash := filepath.ToSlash(mockBin)
		err := exec.Command("bash", "-c", "echo '#!/bin/bash' > '"+mockBinSlash+"' && echo 'mockbinary' >> '"+mockBinSlash+"' && chmod -x '"+mockBinSlash+"'").Run()
		if err != nil {
			t.Fatalf("Failed to create and chmod -x mockBin via bash: %v", err)
		}

		if isBashExecutable(mockBinSlash) {
			t.Skip("Shell execution bit cannot be reliably represented on this Windows runner")
		}

		mockBinData, err := os.ReadFile(mockBin)
		if err != nil {
			t.Fatalf("Failed to read mock binary for hashing: %v", err)
		}
		hashBytes := sha256.Sum256(mockBinData)
		return hex.EncodeToString(hashBytes[:])
	}

	// Test 1: Missing source artifact
	os.Remove(mockBin)
	cmd := exec.Command("bash", scriptPath, "0000000000000000000000000000000000000000000000000000000000000000")
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with missing binary, but got success")
	}
	if !strings.Contains(string(out), "Error: Binary bin/linux/gelt not found") {
		t.Fatalf("Expected missing binary error, got: %s", string(out))
	}

	// Test 2: Non-executable source artifact
	realHash := setupNonExecutableFixture()
	cmd = exec.Command("bash", scriptPath, realHash)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with non-executable binary, but got success")
	}
	if !strings.Contains(string(out), "Error: Source binary bin/linux/gelt is not executable") {
		t.Fatalf("Expected non-executable binary error, got: %s", string(out))
	}

	// Test 3: No arguments (missing SHA)
	realHash = setupExecutableFixture()
	cmd = exec.Command("bash", scriptPath)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with no SHA provided, but got success")
	}
	if !strings.Contains(string(out), "Error: A valid 64-character hex SHA-256 must be provided") {
		t.Fatalf("Expected missing SHA error, got: %s", string(out))
	}

	// Test 4: Malformed SHA
	realHash = setupExecutableFixture()
	cmd = exec.Command("bash", scriptPath, "invalid-sha")
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with malformed SHA provided, but got success")
	}
	if !strings.Contains(string(out), "Error: A valid 64-character hex SHA-256 must be provided") {
		t.Fatalf("Expected malformed SHA error, got: %s", string(out))
	}

	// Test 5: Mismatched SHA (valid hex but wrong hash)
	realHash = setupExecutableFixture()
	cmd = exec.Command("bash", scriptPath, "0000000000000000000000000000000000000000000000000000000000000000")
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with mismatched SHA provided, but got success")
	}
	if !strings.Contains(string(out), "Error: SHA-256 mismatch") {
		t.Fatalf("Expected mismatched SHA error, got: %s", string(out))
	}

	// Test 6: Incorrect ownership
	realHash = setupExecutableFixture()
	os.WriteFile(pStat, []byte("#!/bin/bash\necho \"root:root\"\n"), 0755)
	cmd = exec.Command("bash", scriptPath, realHash)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("Expected failure with incorrect ownership, but got success")
	}
	if !strings.Contains(string(out), "Error: Incorrect ownership") {
		t.Fatalf("Expected incorrect ownership error, got: %s", string(out))
	}

	// Restore ownership mock to success
	os.WriteFile(pStat, []byte("#!/bin/bash\necho \"gelt:gelt\"\n"), 0755)

	// Test 7: Successful Hash matching (lowercase)
	realHash = setupExecutableFixture()
	cmd = exec.Command("bash", scriptPath, realHash)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Expected success with valid SHA, but got failure: %v\nOutput: %s", err, string(out))
	}

	// Test 8: Successful Hash matching (uppercase)
	realHash = setupExecutableFixture()
	upperHash := strings.ToUpper(realHash)
	cmd = exec.Command("bash", scriptPath, upperHash)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnv
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Expected success with valid uppercase SHA, but got failure: %v\nOutput: %s", err, string(out))
	}

	// Verify that the rendered service file accurately uses GELT_OPT_DIR
	renderedSvcPath := filepath.Join(systemdDir, "gelt-shadow.service")
	renderedSvcData, err := os.ReadFile(renderedSvcPath)
	if err != nil {
		t.Fatalf("Failed to read rendered service file: %v", err)
	}
	renderedSvcStr := string(renderedSvcData)

	expectedExecStart := "ExecStart=" + filepath.ToSlash(optDir) + "/bin/linux/gelt shadow daemon"
	if !strings.Contains(renderedSvcStr, expectedExecStart) {
		t.Errorf("Rendered service file missing expected ExecStart. Expected to contain: %s", expectedExecStart)
	}

	expectedWorkDir := "WorkingDirectory=" + filepath.ToSlash(optDir)
	if !strings.Contains(renderedSvcStr, expectedWorkDir) {
		t.Errorf("Rendered service file missing expected WorkingDirectory. Expected to contain: %s", expectedWorkDir)
	}

	// Test 9: Regression for sed unsafety (metacharacters in path)
	realHash = setupExecutableFixture()
	optDirUnsafe := filepath.Join(tmpDir, "tmp", "gelt&a")
	scriptEnvUnsafe := append(os.Environ(),
		newPath,
		"GELT_OPT_DIR="+filepath.ToSlash(optDirUnsafe),
		"GELT_HOME_DIR="+filepath.ToSlash(homeDir),
		"SYSTEMD_DIR="+filepath.ToSlash(systemdDir),
	)

	// Create required mock directories for the script
	os.MkdirAll(filepath.Join(optDirUnsafe, "bin", "linux"), 0755)

	cmd = exec.Command("bash", scriptPath, realHash)
	cmd.Dir = tmpDir
	cmd.Env = scriptEnvUnsafe
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Expected success with unsafe opt dir containing metacharacters, but got failure: %v\nOutput: %s", err, string(out))
	}

	renderedSvcDataUnsafe, err := os.ReadFile(renderedSvcPath)
	if err != nil {
		t.Fatalf("Failed to read rendered service file for unsafe path test: %v", err)
	}
	renderedSvcStrUnsafe := string(renderedSvcDataUnsafe)

	expectedExecStartUnsafe := "ExecStart=" + filepath.ToSlash(optDirUnsafe) + "/bin/linux/gelt shadow daemon"
	if !strings.Contains(renderedSvcStrUnsafe, expectedExecStartUnsafe) {
		t.Errorf("Rendered service file with unsafe path missing expected ExecStart. Expected to contain: %s", expectedExecStartUnsafe)
	}
}
