package teaminbox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/orchestrator"
)

type FilesystemTeamInbox struct {
	baseDir       string
	mu            sync.RWMutex
	messageCounts map[string]int
}

type filesystemRoot interface {
	MkdirAll(string, os.FileMode) error
	OpenFile(string, int, os.FileMode) (filesystemFile, error)
	ReadFile(string) ([]byte, error)
	Remove(string) error
	Rename(string, string) error
	Close() error
}

type filesystemReader interface {
	ReadFile(string) ([]byte, error)
}

type filesystemFile interface {
	Write([]byte) (int, error)
	Close() error
}

type realFilesystemRoot struct {
	*os.Root
}

func (r realFilesystemRoot) OpenFile(name string, flag int, perm os.FileMode) (filesystemFile, error) {
	return r.Root.OpenFile(name, flag, perm)
}

func NewFilesystemTeamInbox(baseDir string) *FilesystemTeamInbox {
	return &FilesystemTeamInbox{
		baseDir:       baseDir,
		messageCounts: map[string]int{},
	}
}

func (i *FilesystemTeamInbox) getFilePath(teamName, agentName string) (string, error) {
	if err := orchestrator.ValidateInboxName(teamName, "team"); err != nil {
		return "", err
	}
	if err := orchestrator.ValidateInboxName(agentName, "agent"); err != nil {
		return "", err
	}
	return filepath.Join(teamName, agentName+".jsonl"), nil
}

func (i *FilesystemTeamInbox) openRoot() (*os.Root, error) {
	rootDir := filepath.Clean(filepath.Join(i.baseDir, "team_inbox"))
	if err := os.MkdirAll(rootDir, 0750); err != nil {
		return nil, err
	}
	return os.OpenRoot(rootDir)
}

var openFilesystemTeamInboxRoot = func(i *FilesystemTeamInbox) (filesystemRoot, error) {
	root, err := i.openRoot()
	if err != nil {
		return nil, err
	}
	return realFilesystemRoot{Root: root}, nil
}

func (i *FilesystemTeamInbox) Write(teamName, to string, msg agent.InboxMessage) error {
	path, err := i.getFilePath(teamName, to)
	if err != nil {
		return err
	}
	root, err := openFilesystemTeamInboxRoot(i)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()

	i.mu.Lock()
	defer i.mu.Unlock()
	if err := root.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return err
	}

	lineCount, err := i.messageCountLocked(root, path)
	if err != nil {
		return err
	}
	if lineCount >= orchestrator.MaxInboxMessages {
		return fmt.Errorf("inbox for %q in team %q has reached the maximum of %d messages", to, teamName, orchestrator.MaxInboxMessages)
	}

	msg.Read = false
	data, err := marshalInboxMessage(msg)
	if err != nil {
		return err
	}

	f, err := root.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	if _, err := f.Write(append(data, '\n')); err != nil {
		return err
	}
	i.messageCounts[path] = lineCount + 1
	return nil
}

func (i *FilesystemTeamInbox) ReadAll(teamName, agentName string) ([]agent.InboxMessage, error) {
	path, err := i.getFilePath(teamName, agentName)
	if err != nil {
		return nil, err
	}
	root, err := openFilesystemTeamInboxRoot(i)
	if err != nil {
		return nil, err
	}
	defer func() { _ = root.Close() }()

	i.mu.RLock()
	defer i.mu.RUnlock()

	data, err := root.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []agent.InboxMessage{}, nil
		}
		return nil, err
	}

	return i.parse(data), nil
}

func (i *FilesystemTeamInbox) Unread(teamName, agentName string) ([]agent.InboxMessage, error) {
	all, err := i.ReadAll(teamName, agentName)
	if err != nil {
		return nil, err
	}

	var unread []agent.InboxMessage
	for _, m := range all {
		if !m.Read {
			unread = append(unread, m)
		}
	}
	return unread, nil
}

func (i *FilesystemTeamInbox) MarkRead(teamName, agentName string) ([]agent.InboxMessage, error) {
	path, err := i.getFilePath(teamName, agentName)
	if err != nil {
		return nil, err
	}
	root, err := openFilesystemTeamInboxRoot(i)
	if err != nil {
		return nil, err
	}
	defer func() { _ = root.Close() }()

	i.mu.Lock()
	defer i.mu.Unlock()

	data, err := root.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !bytes.Contains(data, []byte(`"read":false`)) {
		return nil, nil
	}

	messages := i.parse(data)

	var read []agent.InboxMessage
	changed := false
	for j, m := range messages {
		if !m.Read {
			messages[j].Read = true
			read = append(read, messages[j])
			changed = true
		}
	}

	if !changed {
		return nil, nil
	}

	tempPath := path + ".tmp"
	f, err := root.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = f.Close()
		_ = root.Remove(tempPath)
	}()

	for _, m := range messages {
		data, err := marshalInboxMessage(m)
		if err != nil {
			return nil, err
		}
		if _, err := f.Write(append(data, '\n')); err != nil {
			return nil, err
		}
	}

	if err := f.Close(); err != nil {
		return nil, err
	}

	if err := root.Rename(tempPath, path); err != nil {
		return nil, err
	}

	i.messageCounts[path] = len(messages)
	return read, nil
}

var marshalInboxMessage = json.Marshal

func (i *FilesystemTeamInbox) Remove(teamName, agentName string) error {
	path, err := i.getFilePath(teamName, agentName)
	if err != nil {
		return err
	}
	root, err := openFilesystemTeamInboxRoot(i)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()

	i.mu.Lock()
	defer i.mu.Unlock()

	err = root.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	delete(i.messageCounts, path)
	return nil
}

func (i *FilesystemTeamInbox) messageCountLocked(root filesystemReader, path string) (int, error) {
	if count, ok := i.messageCounts[path]; ok {
		return count, nil
	}

	data, err := root.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			i.messageCounts[path] = 0
			return 0, nil
		}
		return 0, err
	}

	count := bytes.Count(data, []byte{'\n'})
	if len(data) > 0 && data[len(data)-1] != '\n' {
		count++
	}
	i.messageCounts[path] = count
	return count, nil
}

func (i *FilesystemTeamInbox) parse(data []byte) []agent.InboxMessage {
	var messages []agent.InboxMessage
	start := 0
	for j := range data {
		if data[j] == '\n' {
			var m agent.InboxMessage
			if err := json.Unmarshal(data[start:j], &m); err != nil {
				start = j + 1
				continue
			}
			messages = append(messages, m)
			start = j + 1
		}
	}
	if start < len(data) {
		remaining := data[start:]
		if len(remaining) > 0 {
			var m agent.InboxMessage
			if err := json.Unmarshal(remaining, &m); err == nil {
				messages = append(messages, m)
			}
		}
	}
	return messages
}

var _ orchestrator.TeamInboxStore = (*FilesystemTeamInbox)(nil)
var _ agent.TeamInbox = (*FilesystemTeamInbox)(nil)
