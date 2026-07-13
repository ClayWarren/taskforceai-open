package run

import "fmt"

func runProfileKey(userID int, orgID *int32) string {
	if orgID != nil {
		return fmt.Sprintf("org:%d:user:%d", *orgID, userID)
	}
	return fmt.Sprintf("user:%d", userID)
}
