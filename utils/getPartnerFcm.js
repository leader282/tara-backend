export function getPartnerFcm(coupleRow, senderPhone) {
  if (coupleRow.user1 === senderPhone) {
    return coupleRow.user2_fcm;
  }
  if (coupleRow.user2 === senderPhone) {
    return coupleRow.user1_fcm;
  }
  return null;
}
