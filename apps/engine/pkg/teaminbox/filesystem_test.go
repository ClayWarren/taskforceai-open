package teaminbox

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeFilesystemRoot struct {
	mkdirAllErr error
	readData    []byte
	readErr     error
	openErr     error
	removeErr   error
	renameErr   error
	file        filesystemFile
}

func (f *fakeFilesystemRoot) MkdirAll(string, os.FileMode) error { return f.mkdirAllErr }
func (f *fakeFilesystemRoot) ReadFile(string) ([]byte, error) {
	if f.readErr != nil {
		return nil, f.readErr
	}
	return f.readData, nil
}
func (f *fakeFilesystemRoot) OpenFile(string, int, os.FileMode) (filesystemFile, error) {
	if f.openErr != nil {
		return nil, f.openErr
	}
	if f.file == nil {
		f.file = &fakeFilesystemFile{}
	}
	return f.file, nil
}
func (f *fakeFilesystemRoot) Remove(string) error         { return f.removeErr }
func (f *fakeFilesystemRoot) Rename(string, string) error { return f.renameErr }
func (f *fakeFilesystemRoot) Close() error                { return nil }

type fakeFilesystemFile struct {
	writeErr error
	closeErr error
}

func (f *fakeFilesystemFile) Write([]byte) (int, error) {
	if f.writeErr != nil {
		return 0, f.writeErr
	}
	return 1, nil
}

func (f *fakeFilesystemFile) Close() error { return f.closeErr }

func withFilesystemRoot(t *testing.T, root filesystemRoot, err error) {
	t.Helper()
	orig := openFilesystemTeamInboxRoot
	openFilesystemTeamInboxRoot = func(*FilesystemTeamInbox) (filesystemRoot, error) {
		if err != nil {
			return nil, err
		}
		return root, nil
	}
	t.Cleanup(func() { openFilesystemTeamInboxRoot = orig })
}

func TestFilesystemTeamInbox(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	msg := agent.InboxMessage{
		ID:   "1",
		From: "lead",
		Text: "hello",
		Read: true,
	}

	require.NoError(t, inbox.Write("team", "worker", msg))

	all, err := inbox.ReadAll("team", "worker")
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.False(t, all[0].Read)

	unread, err := inbox.Unread("team", "worker")
	require.NoError(t, err)
	require.Len(t, unread, 1)

	read, err := inbox.MarkRead("team", "worker")
	require.NoError(t, err)
	require.Len(t, read, 1)
	assert.True(t, read[0].Read)

	unread, err = inbox.Unread("team", "worker")
	require.NoError(t, err)
	assert.Empty(t, unread)

	require.NoError(t, inbox.Remove("team", "worker"))
	all, err = inbox.ReadAll("team", "worker")
	require.NoError(t, err)
	assert.Empty(t, all)
}

func TestFilesystemTeamInboxRejectsInvalidNames(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())

	err := inbox.Write("../team", "worker", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"})
	require.ErrorContains(t, err, "invalid team name")

	_, err = inbox.ReadAll("team", "../worker")
	require.ErrorContains(t, err, "invalid agent name")
}

func TestFilesystemTeamInboxMarkReadAtomicWrite(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	require.NoError(t, inbox.Write("team", "worker", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"}))

	path, err := inbox.getFilePath("team", "worker")
	require.NoError(t, err)

	root, err := inbox.openRoot()
	require.NoError(t, err)
	tempPath := path + ".tmp"
	require.NoError(t, root.MkdirAll(filepath.Dir(tempPath), 0o750))
	require.NoError(t, root.Mkdir(tempPath, 0o750))
	require.NoError(t, root.Close())

	_, err = inbox.MarkRead("team", "worker")
	require.Error(t, err)

	all, err := inbox.ReadAll("team", "worker")
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.False(t, all[0].Read)
}

func TestFilesystemTeamInboxErrorEdges(t *testing.T) {
	unreadLine := []byte(`{"id":"1","from":"lead","text":"hi","read":false}` + "\n")

	t.Run("open root reports mkdir failure", func(t *testing.T) {
		baseFile := filepath.Join(t.TempDir(), "base-file")
		require.NoError(t, os.WriteFile(baseFile, []byte("not a dir"), 0o600))

		inbox := NewFilesystemTeamInbox(baseFile)
		_, err := inbox.openRoot()
		require.Error(t, err)

		_, err = openFilesystemTeamInboxRoot(inbox)
		require.Error(t, err)
	})

	t.Run("write returns open root failure", func(t *testing.T) {
		withFilesystemRoot(t, nil, errors.New("open failed"))

		err := NewFilesystemTeamInbox("ignored").Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "open failed")
	})

	t.Run("write returns mkdir failure", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{mkdirAllErr: errors.New("mkdir failed")}, nil)

		err := NewFilesystemTeamInbox("ignored").Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "mkdir failed")
	})

	t.Run("write returns message count failure", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readErr: errors.New("count failed")}, nil)

		err := NewFilesystemTeamInbox("ignored").Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "count failed")
	})

	t.Run("write returns open file failure", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readErr: os.ErrNotExist, openErr: errors.New("open file failed")}, nil)

		err := NewFilesystemTeamInbox("ignored").Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "open file failed")
	})

	t.Run("write returns append error", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{
			readErr: os.ErrNotExist,
			file:    &fakeFilesystemFile{writeErr: errors.New("append failed")},
		}, nil)

		err := NewFilesystemTeamInbox("ignored").Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "append failed")
	})

	t.Run("read all returns open root failure", func(t *testing.T) {
		withFilesystemRoot(t, nil, errors.New("open failed"))

		_, err := NewFilesystemTeamInbox("ignored").ReadAll("team", "agent")
		require.ErrorContains(t, err, "open failed")
	})

	t.Run("read all returns non missing read failure", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readErr: errors.New("read failed")}, nil)

		_, err := NewFilesystemTeamInbox("ignored").ReadAll("team", "agent")
		require.ErrorContains(t, err, "read failed")
	})

	t.Run("unread returns read all failure", func(t *testing.T) {
		withFilesystemRoot(t, nil, errors.New("open failed"))

		_, err := NewFilesystemTeamInbox("ignored").Unread("team", "agent")
		require.ErrorContains(t, err, "open failed")
	})

	t.Run("mark read open root failure", func(t *testing.T) {
		withFilesystemRoot(t, nil, errors.New("open failed"))

		_, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
		require.ErrorContains(t, err, "open failed")
	})

	t.Run("mark read rejects invalid agent name", func(t *testing.T) {
		_, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "../agent")
		require.ErrorContains(t, err, "invalid agent name")
	})

	t.Run("mark read returns nil for missing file", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readErr: os.ErrNotExist}, nil)

		read, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
		require.NoError(t, err)
		assert.Nil(t, read)
	})

	t.Run("mark read returns non missing read failure", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readErr: errors.New("read failed")}, nil)

		_, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
		require.ErrorContains(t, err, "read failed")
	})

	t.Run("mark read returns nil when data is already read", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readData: []byte(`{"id":"1","from":"lead","text":"hi","read":true}` + "\n")}, nil)

		read, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
		require.NoError(t, err)
		assert.Nil(t, read)
	})

	t.Run("mark read returns unchanged after invalid unread-looking data", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{readData: []byte(`not-json "read":false`)}, nil)

		read, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
		require.NoError(t, err)
		assert.Nil(t, read)
	})

	t.Run("mark read returns write close and rename errors", func(t *testing.T) {
		cases := []struct {
			name string
			root *fakeFilesystemRoot
			want string
		}{
			{
				name: "write",
				root: &fakeFilesystemRoot{readData: unreadLine, file: &fakeFilesystemFile{
					writeErr: errors.New("write failed"),
				}},
				want: "write failed",
			},
			{
				name: "close",
				root: &fakeFilesystemRoot{readData: unreadLine, file: &fakeFilesystemFile{
					closeErr: errors.New("close failed"),
				}},
				want: "close failed",
			},
			{
				name: "rename",
				root: &fakeFilesystemRoot{
					readData:  unreadLine,
					file:      &fakeFilesystemFile{},
					renameErr: errors.New("rename failed"),
				},
				want: "rename failed",
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				withFilesystemRoot(t, tc.root, nil)

				_, err := NewFilesystemTeamInbox("ignored").MarkRead("team", "agent")
				require.ErrorContains(t, err, tc.want)
			})
		}
	})

	t.Run("remove rejects invalid agent name", func(t *testing.T) {
		err := NewFilesystemTeamInbox("ignored").Remove("team", "../agent")
		require.ErrorContains(t, err, "invalid agent name")
	})

	t.Run("remove returns open root failure", func(t *testing.T) {
		withFilesystemRoot(t, nil, errors.New("open failed"))

		err := NewFilesystemTeamInbox("ignored").Remove("team", "agent")
		require.ErrorContains(t, err, "open failed")
	})

	t.Run("remove returns non missing error", func(t *testing.T) {
		withFilesystemRoot(t, &fakeFilesystemRoot{removeErr: errors.New("remove failed")}, nil)

		err := NewFilesystemTeamInbox("ignored").Remove("team", "agent")
		require.ErrorContains(t, err, "remove failed")
	})
}

func TestFilesystemTeamInboxWriteLimitAndReservationRollback(t *testing.T) {
	t.Run("cached max blocks without reserving", func(t *testing.T) {
		inbox := NewFilesystemTeamInbox(t.TempDir())
		path, err := inbox.getFilePath("team", "agent")
		require.NoError(t, err)
		inbox.messageCounts[path] = orchestrator.MaxInboxMessages

		err = inbox.Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.ErrorContains(t, err, "maximum")
		assert.Equal(t, orchestrator.MaxInboxMessages, inbox.messageCounts[path])
	})

	t.Run("append failure keeps cached count unchanged", func(t *testing.T) {
		baseDir := t.TempDir()
		inbox := NewFilesystemTeamInbox(baseDir)
		path, err := inbox.getFilePath("team", "agent")
		require.NoError(t, err)
		inbox.messageCounts[path] = 0

		blockingPath := filepath.Join(baseDir, "team_inbox", path)
		require.NoError(t, os.MkdirAll(blockingPath, 0o750))

		err = inbox.Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hi"})
		require.Error(t, err)
		assert.Equal(t, 0, inbox.messageCounts[path])
	})
}

func TestFilesystemTeamInboxParseSkipsMalformedEntries(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	data := []byte(strings.Join([]string{
		`{"id":"1","from":"lead","text":"ok","read":false}`,
		`{bad json}`,
		`{"id":"2","from":"lead","text":"tail","read":true}`,
	}, "\n"))

	got := inbox.parse(data)
	require.Len(t, got, 2)
	assert.Equal(t, "1", got[0].ID)
	assert.Equal(t, "2", got[1].ID)
}

func TestFilesystemTeamInboxMarshalFailures(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	origMarshal := marshalInboxMessage
	t.Cleanup(func() { marshalInboxMessage = origMarshal })

	marshalInboxMessage = func(any) ([]byte, error) { return nil, errors.New("marshal failed") }
	err := inbox.Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"})
	require.Error(t, err)

	marshalInboxMessage = origMarshal
	require.NoError(t, inbox.Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"}))

	marshalInboxMessage = func(any) ([]byte, error) { return nil, errors.New("marshal failed") }
	_, err = inbox.MarkRead("team", "agent")
	require.Error(t, err)
}

func FuzzFilesystemTeamInboxParse(f *testing.F) {
	f.Add([]byte(`{"id":"1","from":"lead","text":"hello","read":false}` + "\n"))
	f.Add([]byte(`bad json` + "\n" + `{"id":"2","from":"lead","text":"ok","read":true}`))

	f.Fuzz(func(t *testing.T, data []byte) {
		inbox := NewFilesystemTeamInbox(t.TempDir())
		for _, msg := range inbox.parse(data) {
			if _, err := json.Marshal(msg); err != nil {
				t.Fatalf("parsed message must be marshalable: %v", err)
			}
		}
	})
}

func TestFilesystemTeamInboxMessageCountLockedEdges(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	root := &fakeFilesystemRoot{readData: []byte("one\ntwo\nthree")}

	count, err := inbox.messageCountLocked(root, "team/agent.jsonl")
	require.NoError(t, err)
	assert.Equal(t, 3, count)

	count, err = inbox.messageCountLocked(root, "team/agent.jsonl")
	require.NoError(t, err)
	assert.Equal(t, 3, count)

	_, err = inbox.messageCountLocked(&fakeFilesystemRoot{readErr: errors.New("read failed")}, "other/agent.jsonl")
	require.ErrorContains(t, err, "read failed")
}

func TestFilesystemTeamInboxAtomicWriteLeavesValidJSONL(t *testing.T) {
	inbox := NewFilesystemTeamInbox(t.TempDir())
	require.NoError(t, inbox.Write("team", "agent", agent.InboxMessage{ID: "1", From: "lead", Text: "hello"}))
	_, err := inbox.MarkRead("team", "agent")
	require.NoError(t, err)

	path, err := inbox.getFilePath("team", "agent")
	require.NoError(t, err)
	root, err := inbox.openRoot()
	require.NoError(t, err)
	defer func() { _ = root.Close() }()

	raw, err := root.ReadFile(path)
	require.NoError(t, err)
	for _, line := range bytes.Split(bytes.TrimSpace(raw), []byte("\n")) {
		var msg agent.InboxMessage
		require.NoError(t, json.Unmarshal(line, &msg))
		assert.True(t, msg.Read)
	}
}
