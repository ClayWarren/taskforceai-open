package core

type Stream interface {
	Next() (Event, bool, error)
}

type SliceStream struct {
	events []Event
	index  int
}

func NewSliceStream(events []Event) *SliceStream {
	return &SliceStream{events: events}
}

func (s *SliceStream) Next() (Event, bool, error) {
	if s.index >= len(s.events) {
		return Event{}, false, nil
	}
	ev := s.events[s.index]
	s.index++
	return ev, true, nil
}
