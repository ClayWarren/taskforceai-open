package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestStore(t *testing.T) {
	s := NewStore()
	sessionID := "s1"

	t.Run("append and get", func(t *testing.T) {
		msg := Message{
			Info:  MessageInfo{Role: RoleUser},
			Parts: []Part{{Type: PartText, Text: "hello"}},
		}
		s.Append(sessionID, msg)

		msgs := s.Messages(sessionID)
		assert.Len(t, msgs, 1)
		assert.Equal(t, "hello", msgs[0].Parts[0].Text)

		// Verify cloning
		msgs[0].Parts[0].Text = "changed"
		assert.Equal(t, "hello", s.sessions[sessionID][0].Parts[0].Text)
	})

	t.Run("append clones caller-owned messages", func(t *testing.T) {
		msg := Message{
			Info: MessageInfo{
				Error: &MessageError{Data: map[string]any{"key": "original"}},
			},
			Parts: []Part{{
				Type: PartTool,
				State: &ToolState{
					Input: map[string]any{"path": "original.txt"},
				},
			}},
		}
		s.Replace(sessionID, nil)
		s.Append(sessionID, msg)

		msg.Info.Error.Data["key"] = "changed"
		msg.Parts[0].State.Input["path"] = "changed.txt"

		msgs := s.Messages(sessionID)
		assert.Equal(t, "original", msgs[0].Info.Error.Data["key"])
		assert.Equal(t, "original.txt", msgs[0].Parts[0].State.Input["path"])
	})

	t.Run("replace", func(t *testing.T) {
		msg2 := Message{Parts: []Part{{Type: PartText, Text: "replaced"}}}
		s.Replace(sessionID, []Message{msg2})

		msgs := s.Messages(sessionID)
		assert.Len(t, msgs, 1)
		assert.Equal(t, "replaced", msgs[0].Parts[0].Text)
	})

	t.Run("replace clones caller-owned messages", func(t *testing.T) {
		messages := []Message{{
			Parts: []Part{{
				Type: PartText,
				Text: "original",
			}},
		}}
		s.Replace(sessionID, messages)
		messages[0].Parts[0].Text = "changed"

		msgs := s.Messages(sessionID)
		assert.Equal(t, "original", msgs[0].Parts[0].Text)
	})

	t.Run("reset", func(t *testing.T) {
		s.Reset(sessionID)
		assert.Empty(t, s.Messages(sessionID))
	})
}

func TestCloneValue(t *testing.T) {
	// Nested map
	m := map[string]any{
		"nested": map[string]any{"k": "v"},
		"slice":  []any{1, "2"},
	}
	clonedRaw := cloneValue(m)
	cloned, ok := clonedRaw.(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, m, cloned)

	// Change original
	nested, ok := m["nested"].(map[string]any)
	assert.True(t, ok)
	nested["k"] = "changed"
	clonedNested, ok := cloned["nested"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "v", clonedNested["k"])
}

func TestCloneMessage(t *testing.T) {
	msg := Message{
		Info: MessageInfo{
			ID:   "m1",
			Role: RoleUser,
			Error: &MessageError{
				Name: "err",
				Data: map[string]any{
					"key": "val",
				},
			},
		},
		Parts: []Part{
			{
				Type: PartText,
				Text: "hello",
				State: &ToolState{
					Metadata: map[string]any{
						"p1": "v1",
					},
				},
			},
		},
	}

	cloned := cloneMessage(msg)

	// Verify identity
	assert.Equal(t, msg.Info.ID, cloned.Info.ID)
	assert.Equal(t, msg.Info.Role, cloned.Info.Role)
	assert.Equal(t, msg.Info.Error.Data, cloned.Info.Error.Data)
	assert.Equal(t, msg.Parts, cloned.Parts)

	// Verify deep copy of Info.Error.Data
	msg.Info.Error.Data["key"] = "changed"
	assert.Equal(t, "val", cloned.Info.Error.Data["key"])

	// Verify deep copy of Parts
	msg.Parts[0].Text = "changed"
	assert.Equal(t, "hello", cloned.Parts[0].Text)

	// Verify deep copy of Part.State.Metadata
	msg.Parts[0].State.Metadata["p1"] = "changed"
	assert.Equal(t, "v1", cloned.Parts[0].State.Metadata["p1"])
}

func TestClonePart(t *testing.T) {
	p := Part{
		Type: PartText,
		Text: "original",
		State: &ToolState{
			Metadata: map[string]any{
				"m": 1,
			},
		},
	}

	cloned := clonePart(p)
	assert.Equal(t, p, cloned)

	p.State.Metadata["m"] = 2
	assert.Equal(t, 1, cloned.State.Metadata["m"])
}

func TestCloneMessageCopiesOptionalFieldsAndAttachments(t *testing.T) {
	model := ModelRef{ProviderID: "provider-a", ModelID: "model-a"}
	tokens := Tokens{Input: 1, Output: 2}
	path := MessagePath{Cwd: "/tmp", Root: "/tmp/project"}
	title := "result"
	msg := Message{
		Info: MessageInfo{
			Model:  &model,
			Tokens: &tokens,
			Path:   &path,
		},
		Parts: []Part{{
			Type:   PartTool,
			Tokens: &tokens,
			State: &ToolState{
				Input: map[string]any{
					"nested": map[string]any{"key": "value"},
					"list":   []any{map[string]any{"item": "one"}},
				},
				Metadata: map[string]any{
					"attachments": []map[string]any{{"name": "a.txt"}},
				},
				Attachments: []map[string]any{{"path": "a.txt"}},
				Title:       &title,
			},
		}},
	}

	cloned := cloneMessage(msg)
	msg.Info.Model.ModelID = "changed"
	msg.Info.Tokens.Input = 99
	msg.Info.Path.Cwd = "changed"
	msg.Parts[0].Tokens.Input = 88
	msg.Parts[0].State.Input["nested"].(map[string]any)["key"] = "changed"
	msg.Parts[0].State.Input["list"].([]any)[0].(map[string]any)["item"] = "changed"
	msg.Parts[0].State.Metadata["attachments"].([]map[string]any)[0]["name"] = "changed"
	msg.Parts[0].State.Attachments[0]["path"] = "changed"
	*msg.Parts[0].State.Title = "changed"

	assert.Equal(t, "model-a", cloned.Info.Model.ModelID)
	assert.Equal(t, 1, cloned.Info.Tokens.Input)
	assert.Equal(t, "/tmp", cloned.Info.Path.Cwd)
	assert.Equal(t, 1, cloned.Parts[0].Tokens.Input)
	assert.Equal(t, "value", cloned.Parts[0].State.Input["nested"].(map[string]any)["key"])
	assert.Equal(t, "one", cloned.Parts[0].State.Input["list"].([]any)[0].(map[string]any)["item"])
	assert.Equal(t, "a.txt", cloned.Parts[0].State.Metadata["attachments"].([]map[string]any)[0]["name"])
	assert.Equal(t, "a.txt", cloned.Parts[0].State.Attachments[0]["path"])
	assert.Equal(t, "result", *cloned.Parts[0].State.Title)
}
