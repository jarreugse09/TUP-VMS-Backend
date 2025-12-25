import express from "express";
import { register, login } from "../controllers/authController";
import { body } from "express-validator";

const router = express.Router();

router.post(
  "/register",
  [
    body("firstName").notEmpty(),
    body("surname").notEmpty(),
    body("birthdate").isISO8601(),
    body("role").isIn(["TUP", "Staff", "Student", "Visitor"]),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
    body("photoURL").notEmpty(),
  ],
  register
);

router.post("/login", login);

export default router;
