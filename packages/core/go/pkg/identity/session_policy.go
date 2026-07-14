package identity

const (
	ConsumerSessionMaxAgeSeconds      = 30 * 24 * 60 * 60
	EnterpriseSessionMaxAgeSeconds    = 12 * 60 * 60
	ImpersonationSessionMaxAgeSeconds = 60 * 60
	MFAPendingSessionMaxAgeSeconds    = 5 * 60
)

type SessionPolicyContext struct {
	HasOrganization bool
	IsImpersonated  bool
}

func ResolveSessionMaxAgeSeconds(context SessionPolicyContext) int {
	if context.IsImpersonated {
		return ImpersonationSessionMaxAgeSeconds
	}
	if context.HasOrganization {
		return EnterpriseSessionMaxAgeSeconds
	}
	return ConsumerSessionMaxAgeSeconds
}
