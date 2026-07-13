package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
)

func TestToolRegistry(t *testing.T) {
	registry := NewToolRegistry()
	tool := CreateTaskDoneTool()

	registry.Register(tool)

	t.Run("Get existing tool", func(t *testing.T) {
		got, ok := registry.Get(tool.Name())
		if !ok || got == nil {
			t.Error("expected to find tool")
		}
	})

	t.Run("Get missing tool", func(t *testing.T) {
		_, ok := registry.Get("missing")
		if ok {
			t.Error("expected not to find missing tool")
		}
	})

	t.Run("All tools", func(t *testing.T) {
		all := registry.All()
		if len(all) != 1 {
			t.Errorf("expected 1 tool, got %d", len(all))
		}
	})
}

func TestDiscoverTools(t *testing.T) {
	cfg := config.Config{}

	t.Run("Default tools", func(t *testing.T) {
		registry := DiscoverTools(cfg, nil, nil, nil, true)
		// 14 default tools: file tools, file generators, and mark_task_complete
		if len(registry.All()) < 14 {
			t.Errorf("expected at least 14 default tools, got %d", len(registry.All()))
		}
		for _, name := range []string{
			"read",
			"write",
			"edit",
			"glob",
			"grep",
			"create_spreadsheet",
			"create_document",
			"create_presentation",
			"create_archive",
			"create_csv",
			"create_pdf",
			"create_chart",
			"create_site",
			"mark_task_complete",
		} {
			if _, ok := registry.Get(name); !ok {
				t.Errorf("expected tool %q to be registered", name)
			}
		}
	})

	t.Run("Without local file tools", func(t *testing.T) {
		registry := DiscoverTools(cfg, nil, nil, nil, false)
		if len(registry.All()) != 9 {
			t.Errorf("expected generated file tools and mark_task_complete when local file tools are disabled, got %d", len(registry.All()))
		}
		if _, ok := registry.Get("mark_task_complete"); !ok {
			t.Error("expected mark_task_complete tool to be registered")
		}
		for _, name := range []string{"read", "write", "edit", "glob", "grep"} {
			if _, ok := registry.Get(name); ok {
				t.Errorf("expected tool %q to be disabled", name)
			}
		}
		for _, name := range []string{
			"create_spreadsheet",
			"create_document",
			"create_presentation",
			"create_archive",
			"create_csv",
			"create_pdf",
			"create_chart",
			"create_site",
		} {
			if _, ok := registry.Get(name); !ok {
				t.Errorf("expected generated file tool %q to be registered", name)
			}
		}
	})

	t.Run("With gateway", func(t *testing.T) {
		mockGateway := &MockSearchGateway{}
		registry := DiscoverTools(cfg, mockGateway, nil, nil, true)
		if len(registry.All()) < 14 {
			t.Errorf("expected at least 14 tools with gateway, got %d", len(registry.All()))
		}
	})
}
