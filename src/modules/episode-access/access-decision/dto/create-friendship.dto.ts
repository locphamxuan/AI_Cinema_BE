export class CreateFriendshipDto {
  receiverId: string;
  /** Set when the sender is inviting the friend into a watch room right away. */
  inviteContext?: { roomId: string };
}
