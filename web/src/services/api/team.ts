import { serverGet, serverPost } from "./server";
import type { TeamSummary } from "@/features/team/stores/use-team-store";

export type ManagedTeam = TeamSummary & { administratorEmail: string | null; administratorUsername: string | null; administratorUserId: number | null; administratorNickname: string | null; memberCount: number; memberLimit: number };
export type JoinedTeam = TeamSummary & { administratorUsername: string | null };
export type TeamMember = { userId: number; email: string | null; username: string; nickname: string; canResetPassword: boolean; isPrimaryAdministrator: boolean; memberRole: "administrator" | "member"; memberStatus: string; teamCreditBalance: string; consumedCredits: string };
export type TeamInvitation = { id: string; teamId: number; teamSlug: string; name: string; email: string | null; invitedAccount: string; invitedUserId: number | null; memberRole: string; invitationStatus?: string; expiresAt: string };
export type TeamResource = { resourceId: string; resourceType: "model" | "objectStorage"; name: string; ownerTeamId: number; channelName?: string; modelType?: string };
export type ConfigurationMode = { moduleName: string; inheritGlobal: boolean };
export type ResourcePreference = { resourceType: string; resourceId: string; enabled: boolean; isDefault: boolean };
export type StorageBill = { id: number; userId: number; teamId: number; ownerTeamId: number; billingMonth: string; credits: string; billStatus: string; usageDetails: string; paidAt: string | null };

export const listTeams = () => serverGet<ManagedTeam[]>("/admin/team/listTeams");
export const listMyTeams = (options?: { signal?: AbortSignal }) => serverGet<JoinedTeam[]>("/team/listMyTeams", options);
export const getPublicTeam = (teamSlug: string, signal?: AbortSignal) => serverGet<TeamSummary>(`/team/getPublicTeam?teamSlug=${encodeURIComponent(teamSlug)}`, { auth: false, signal });
export const listMyInvitations = () => serverGet<TeamInvitation[]>("/team/listMyInvitations");
export const acceptInvitation = (invitationId: string) => serverPost<TeamSummary>("/team/acceptInvitation", { invitationId });
export const listMembers = () => serverGet<TeamMember[]>("/team/listMembers");
export const getManagedTeam = () => serverGet<ManagedTeam & { consumedCredits: string }>("/team/getTeam");
export const resetMemberPassword = (input: { userId: number; newPassword: string }) => serverPost("/team/resetMemberPassword", input);
export const updateMemberRole = (input: { userId: number; memberRole: TeamMember["memberRole"] }) => serverPost("/team/updateMemberRole", input);
export const resendInvitation = (invitationId: string) => serverPost("/team/resendInvitation", { invitationId });
export const listInvitations = () => serverGet<TeamInvitation[]>("/team/listInvitations");
export const listAvailableResources = () => serverGet<TeamResource[]>("/team/listAvailableResources");
export const listConfigurationModes = () => serverGet<ConfigurationMode[]>("/team/listConfigurationModes");
export const listResourcePreferences = () => serverGet<ResourcePreference[]>("/team/listResourcePreferences");
export const listTeamBills = () => serverGet<StorageBill[]>("/storage/listTeamBills");
export const getWalletBalances = () => serverGet<{ platformBalance: string; teamBalance: string; teamId: number }>("/credit/getWalletBalances");

export type TeamCreditTransaction = { id: number; email: string | null; username: string; transactionType: string; changeAmount: string; walletTeamId: number; beneficiaryTeamId: number; balanceAfter: string | null; reason: string; createdAt: string };
export const listTeamCreditTransactions = () => serverGet<TeamCreditTransaction[]>("/team/listCreditTransactions");
