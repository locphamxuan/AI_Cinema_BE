/** At least one letter and one digit; the length (8–72, bcrypt's limit) is checked separately. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const PASSWORD_HINT = 'Password of 8 to 72 characters with at least one letter and one digit.';
