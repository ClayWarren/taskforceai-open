package orchestrator

import (
	"context"
	"fmt"
	"log/slog"
)

func (s *TeamService) ApprovePlan(ctx context.Context, teamName, memberName string, approved bool, feedback string) error {
	s.mu.Lock()
	team, err := s.store.GetTeam(ctx, teamName)
	if err != nil {
		s.mu.Unlock()
		return err
	}

	idx := memberIndex(team.Members, memberName)
	if idx == -1 {
		s.mu.Unlock()
		return ErrMemberNotFound
	}

	if approved {
		if err := s.sessions.UpdatePermissions(ctx, team.Members[idx].SessionID, "*:plan-approval"); err != nil {
			s.mu.Unlock()
			return err
		}
		team.Members[idx].PlanApproval = PlanApprovalApproved
	} else {
		team.Members[idx].PlanApproval = PlanApprovalRejected
	}

	if err := s.store.SaveTeam(ctx, team); err != nil {
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()

	s.sendPlanFeedback(ctx, teamName, memberName, approved, feedback)

	if pubErr := s.bus.Publish(ctx, "team.plan.approval", map[string]any{
		"teamName":   teamName,
		"memberName": memberName,
		"approved":   approved,
		"feedback":   feedback,
	}); pubErr != nil {
		slog.Warn("bus.Publish team.plan.approval failed", "error", pubErr)
	}

	return nil
}

func (s *TeamService) sendPlanFeedback(ctx context.Context, teamName, memberName string, approved bool, feedback string) {
	action := "REJECTED"
	detail := "Please revise and resubmit."
	if approved {
		action = "APPROVED"
		detail = "You now have full write access."
	}
	msg := fmt.Sprintf("Your plan has been %s. %s", action, detail)
	if feedback != "" {
		msg += " Feedback: " + feedback
	}
	if err := s.Send(ctx, teamName, "lead", memberName, msg); err != nil {
		slog.Warn("Failed to send plan feedback message", "teamName", teamName, "memberName", memberName, "error", err)
	}
}
