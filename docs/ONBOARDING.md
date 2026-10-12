---
type: guide
title: Gelt Developer Onboarding Guide
---

# Gelt Developer Onboarding Guide

Welcome to the Gelt Agentic Trading Suite! This guide will walk you through setting up Gelt on a fresh local machine, allowing you to start developing and contributing quickly.

## Prerequisites

Before cloning the repository, ensure your system meets the following requirements:

1. **Go (Golang)**: Gelt is built in Go. You must have **Go 1.22 or newer** installed.
   - Download and install from [golang.org/dl](https://golang.org/dl/).
   - Verify installation: `go version`

2. **Git**: Required for version control and fetching the repository.
   - Download and install from [git-scm.com](https://git-scm.com/).
   - Verify installation: `git --version`

3. **Operating System**: Gelt is designed for cross-platform development (Linux, macOS, Windows).
   - *Note for Windows users:* The commands in this guide generally assume a Unix-like shell (bash, zsh) or PowerShell. Adjust syntax if using standard Command Prompt.

## Step-by-Step Setup

### 1. Clone the Repository

Clone the Gelt repository to your local workspace:

```bash
git clone https://github.com/your-org/gelt.git
cd gelt
```

### 2. Install Dependencies

Gelt uses Go modules for dependency management. Download and verify the required dependencies:

```bash
go mod download
go mod verify
```

### 3. Environment Configuration

Gelt relies on environment variables for API keys and configuration settings.

1. Locate the `.env.example` file in the root directory.
2. Copy it to create your local `.env` file:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` in your preferred text editor and fill in the required values. **Never commit real API keys or secrets to the repository.**

### 4. Build the CLI Binary

Compile the Gelt command-line interface:

```bash
go build -o gelt.exe ./cmd/gelt
```
*(On macOS/Linux, you can simply use `-o gelt` without the `.exe` extension).*

### 5. Run the Test Suite

Verify your installation by running the Go test suite. This ensures the core logic is functioning correctly on your machine:

```bash
go test ./...
```

You can also run the CLI's built-in test suite command:

```bash
./gelt.exe test-suite
```

### 6. Launch the Dashboard

To verify the telemetry server and embedded UI are working, start the dashboard:

```bash
./gelt.exe dashboard
```
This will start the local server and automatically open the Gelt dashboard in your default web browser.

## The `docs/specs/` System of Record

In the Gelt project, we maintain a strict **System of Record** for tasks, features, and significant changes within the `docs/specs/` directory.

When you are assigned a task (e.g., implementing a new feature or fixing a complex bug):

1. **Specification:** Before coding, a specification document (e.g., `TASK_001_Feature_Name.md`) may be created here to outline the requirements and architecture.
2. **Completion Report:** Upon finishing a task, you must generate a completion report detailing the changes made, the files updated, and the verification steps taken. This report is saved directly in the `docs/specs/` folder.

This process ensures clear documentation of all architectural decisions and project history, facilitating easier onboarding and code reviews for the entire team. Please review existing files in `docs/specs/` for formatting conventions.
